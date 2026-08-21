import { FLAGS, MODULE_ID } from "./constants.js";
import { setting } from "./settings.js";
import { postCraftingChatCard } from "./chat.js";
import {
  consumeOwnedItemDocument,
  getItemQuantity,
  getItemQuantityPath,
  normalizeName
} from "./item-utils.js";
import { addOwnedMaterialQuantity, getMatchingOwnedMaterialItems } from "./material-identity.js";
import { getRecipeDeconstructMaterials, getRecipeEntriesForActor, hasRecipeDeconstruction, isRecipeItem, sanitizeRecipeData } from "./recipe-utils.js";
import { aggregateRefundMaterials, normalizeRecoverableState, takeOneRefund } from "./deconstruction-refund.js";
import { confirmDialog } from "./application-v2.js";
import { acquireOperationLock } from "./operation-lock.js";

function getCraftedFlag(item) {
  return item?.getFlag?.(MODULE_ID, FLAGS.CRAFTED) ?? null;
}

function sameText(a, b) {
  return normalizeName(a) === normalizeName(b);
}

function snapshotItem(item) {
  if (!item) return null;
  const crafted = getCraftedFlag(item);
  return {
    id: item.id,
    qty: getItemQuantity(item),
    quantityPath: getItemQuantityPath(item),
    source: item.toObject(),
    hadCraftedFlag: crafted !== null && crafted !== undefined,
    crafted: crafted ? foundry.utils.deepClone(crafted) : null
  };
}

function findActorItem(actor, itemId) {
  return actor?.items?.get?.(itemId) ?? actor?.items?.find?.((item) => item.id === itemId) ?? null;
}

async function restoreItemSnapshot(actor, snapshot) {
  if (!actor || !snapshot) return;
  const current = findActorItem(actor, snapshot.id);

  if (!current) {
    const source = foundry.utils.deepClone(snapshot.source);
    await actor.createEmbeddedDocuments("Item", [source], { keepId: true });
    return;
  }

  if (snapshot.quantityPath) {
    await current.update({ [snapshot.quantityPath]: snapshot.qty });
  }

  if (snapshot.hadCraftedFlag) {
    await current.setFlag(MODULE_ID, FLAGS.CRAFTED, foundry.utils.deepClone(snapshot.crafted));
  } else if (getCraftedFlag(current) !== null) {
    await current.unsetFlag(MODULE_ID, FLAGS.CRAFTED);
  }
}

async function rollbackDeconstruction(actor, sourceSnapshot, refundOperations = []) {
  const errors = [];

  for (const operation of [...refundOperations].reverse()) {
    try {
      if (operation.createdItemId) {
        const created = findActorItem(actor, operation.createdItemId);
        if (created) await actor.deleteEmbeddedDocuments("Item", [created.id]);
      } else if (operation.snapshot) {
        await restoreItemSnapshot(actor, operation.snapshot);
      }
    } catch (error) {
      errors.push(error);
      console.error(`${MODULE_ID} | Failed to roll back recovered material`, error);
    }
  }

  try {
    await restoreItemSnapshot(actor, sourceSnapshot);
  } catch (error) {
    errors.push(error);
    console.error(`${MODULE_ID} | Failed to roll back deconstructed source item`, error);
  }

  return { ok: errors.length === 0, errors };
}

export function recipeMatchesItem(recipe, item) {
  if (!recipe || !item) return false;
  if (!sameText(recipe.outputName, item.name)) return false;

  const recipeType = String(recipe.outputType || "").trim();
  const itemType = String(item.type || "").trim();
  return !recipeType || !itemType || recipeType === itemType;
}

export function findRecipeForOutputItemSync(item) {
  const crafted = getCraftedFlag(item);
  if (crafted?.recipeSnapshot) {
    try {
      return sanitizeRecipeData(crafted.recipeSnapshot, {
        id: crafted.recipeId || crafted.recipeSnapshot.id,
        bookId: crafted.recipeBookId || crafted.recipeSnapshot.bookId
      });
    } catch (_error) {
      // Fall through to active recipe matching.
    }
  }

  const entries = getRecipeEntriesForActor(null, { activeOnly: false });
  const byRecipeId = String(crafted?.recipeId || "").trim();
  const byRecipeBookId = String(crafted?.recipeBookId || "").trim();
  if (byRecipeId) {
    const found = entries.find((entry) => (
      String(entry.recipe?.id || entry.id) === byRecipeId
      && (!byRecipeBookId || String(entry.bookId || entry.recipe?.bookId || "") === byRecipeBookId)
    ));
    if (found?.recipe) return found.recipe;
  }

  const exact = entries.find((entry) => recipeMatchesItem(entry.recipe, item));
  return exact?.recipe ?? null;
}

async function findRecipeForOutputItem(item) {
  return findRecipeForOutputItemSync(item);
}

function getRecipeDefaultMaterials(recipe) {
  const choices = [];
  for (const group of recipe?.materialGroups ?? []) {
    const material = group?.alternatives?.[0];
    if (material) choices.push(material);
  }
  return aggregateRefundMaterials(choices);
}

function getActualConsumedMaterials(item, recipe) {
  const crafted = getCraftedFlag(item);
  if (Array.isArray(crafted?.consumedMaterials) && crafted.consumedMaterials.length) {
    return aggregateRefundMaterials(crafted.consumedMaterials.filter((material) => material?.kind !== "gold"));
  }

  return getRecipeDefaultMaterials(recipe);
}

function getCreatedQty(item, recipe) {
  const crafted = getCraftedFlag(item);
  const createdQty = Number(crafted?.createdQty || recipe?.outputQty || 1);
  return Math.max(1, Number.isFinite(createdQty) ? createdQty : 1);
}

function getConservativeGeneratedRefund(recipe) {
  const createdQty = Math.max(1, Number(recipe?.outputQty || 1));
  return aggregateRefundMaterials(getRecipeDefaultMaterials(recipe).map((material) => {
    const totalRecoverable = Math.ceil(Math.max(0, Number(material.qty || 0)) / 2);
    return {
      ...material,
      qty: Math.floor(totalRecoverable / createdQty)
    };
  }));
}

function getGeneratedRefundPlan(item, recipe) {
  const crafted = getCraftedFlag(item);

  // Only items carrying crafted batch metadata can safely consume a shared
  // batch refund pool. Recipe-matched legacy/untracked items use a conservative
  // per-item fallback that can never exceed half the recipe input across all
  // outputs from one recipe execution.
  if (!crafted) {
    return {
      generated: true,
      tracked: false,
      refundMaterials: getConservativeGeneratedRefund(recipe),
      nextState: null
    };
  }

  const state = normalizeRecoverableState({
    storedPool: crafted.recoverableMaterials,
    storedRemainingQty: crafted.remainingQty,
    consumedMaterials: getActualConsumedMaterials(item, recipe),
    createdQty: getCreatedQty(item, recipe),
    currentQty: getItemQuantity(item)
  });

  const taken = takeOneRefund(state);
  return {
    generated: true,
    tracked: true,
    refundMaterials: taken.refundMaterials,
    nextState: taken.nextState
  };
}

function getRefundPlan(item, recipe) {
  if (recipe?.deconstructGenerated) return getGeneratedRefundPlan(item, recipe);

  return {
    generated: false,
    tracked: false,
    refundMaterials: getRecipeDeconstructMaterials(recipe),
    nextState: null
  };
}

function getRefundMaterials(item, recipe) {
  return getRefundPlan(item, recipe).refundMaterials;
}

async function persistGeneratedRefundState(item, recipe, plan) {
  if (!plan?.tracked || !plan.nextState) return;

  const actor = item?.parent;
  const remainingItem = findActorItem(actor, item.id);
  if (!remainingItem) return;

  const crafted = getCraftedFlag(remainingItem) || getCraftedFlag(item) || {};
  const nextCrafted = {
    ...crafted,
    recipeId: crafted.recipeId || recipe?.id || "",
    recipeBookId: crafted.recipeBookId || recipe?.bookId || "",
    recipeName: crafted.recipeName || recipe?.outputName || remainingItem.name || "",
    createdQty: Math.max(1, Number(crafted.createdQty || recipe?.outputQty || 1)),
    remainingQty: Math.max(0, Number(plan.nextState.remainingQty) || 0),
    recoverableMaterials: aggregateRefundMaterials(plan.nextState.recoverableMaterials || [])
  };

  await remainingItem.setFlag(MODULE_ID, FLAGS.CRAFTED, nextCrafted);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

async function confirmDeconstruction(item, recipe, refundMaterials) {
  const materialList = refundMaterials.length
    ? `<ul>${refundMaterials.map((material) => `<li>${escapeHtml(material.name)} x${material.qty}</li>`).join("")}</ul>`
    : `<p><em>${game.i18n.localize("MKSDC.Deconstruct.NoMaterials")}</em></p>`;

  return confirmDialog({
    title: game.i18n.format("MKSDC.Deconstruct.Title", { name: item.name }),
    content: `
      <div class="mk-sdc mk-sdc-deconstruct-dialog">
        <p>${game.i18n.format("MKSDC.Deconstruct.Content", { name: escapeHtml(item.name), recipe: escapeHtml(recipe.outputName) })}</p>
        ${materialList}
      </div>`,
    defaultYes: false
  });
}

export function getDeconstructionPreview(item) {
  if (!item || isRecipeItem(item)) return null;
  const recipe = findRecipeForOutputItemSync(item);
  if (!recipe || !hasRecipeDeconstruction(recipe)) return null;

  const refundMaterials = getRefundMaterials(item, recipe);
  return {
    item,
    id: item.id,
    uuid: item.uuid || "",
    name: item.name || "",
    img: item.img || "icons/svg/item-bag.svg",
    type: item.type || "",
    qty: getItemQuantity(item),
    recipe,
    recipeId: recipe.id || "",
    recipeName: recipe.outputName || item.name || "",
    refundMaterials,
    refundSummary: refundMaterials.length ? refundMaterials.map((material) => `${material.name} x${material.qty}`).join(", ") : game.i18n.localize("MKSDC.Deconstruct.NoMaterials"),
    hasRefundMaterials: refundMaterials.length > 0,
    canDeconstruct: canDeconstructItem(item)
  };
}

function getInventoryDeconstructionEntry(item) {
  if (!item || isRecipeItem(item)) return null;
  const qty = getItemQuantity(item);
  if (qty <= 0) return null;

  const recipe = findRecipeForOutputItemSync(item);
  if (!recipe || !hasRecipeDeconstruction(recipe)) return null;

  const refundMaterials = getRefundMaterials(item, recipe);
  const canDeconstruct = canDeconstructItem(item);

  return {
    item,
    id: item.id,
    uuid: item.uuid || "",
    name: item.name || "",
    img: item.img || "icons/svg/item-bag.svg",
    type: item.type || "",
    qty,
    recipe,
    recipeId: recipe.id || "",
    recipeName: recipe.outputName || "",
    refundMaterials,
    refundSummary: refundMaterials.length ? refundMaterials.map((material) => `${material.name} x${material.qty}`).join(", ") : "",
    hasRefundMaterials: refundMaterials.length > 0,
    hasRecipe: true,
    canDeconstruct
  };
}

export function getInventoryDeconstructionEntriesForActor(actor) {
  if (!actor?.items) return [];
  if (!game.user?.isGM && !actor.isOwner) return [];
  if (!game.user?.isGM && !setting("allowPlayerCrafting")) return [];

  const entries = [];
  for (const item of actor.items) {
    const entry = getInventoryDeconstructionEntry(item);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => String(a.name).localeCompare(String(b.name), game.i18n.lang, { sensitivity: "base", numeric: true }));
}

export function getDeconstructableInventoryForActor(actor) {
  return getInventoryDeconstructionEntriesForActor(actor).filter((entry) => entry.canDeconstruct);
}

export function hasDeconstructionRecipeForItem(item) {
  if (!item || isRecipeItem(item)) return false;
  const recipe = findRecipeForOutputItemSync(item);
  return Boolean(recipe && hasRecipeDeconstruction(recipe));
}

function itemsMatchForDeconstruction(referenceItem, ownedItem) {
  if (!referenceItem || !ownedItem) return false;
  if (!sameText(referenceItem.name, ownedItem.name)) return false;

  const referenceType = String(referenceItem.type || "").trim();
  const ownedType = String(ownedItem.type || "").trim();
  if (referenceType && ownedType && referenceType !== ownedType) return false;

  return true;
}

export function findOwnedDeconstructableItem(actor, referenceItem) {
  if (!actor?.items || !referenceItem) return null;

  if (referenceItem.parent?.id === actor.id && canDeconstructItem(referenceItem)) return referenceItem;

  const byUuid = String(referenceItem.uuid || "").trim();
  if (byUuid) {
    const matchedByUuid = actor.items.find((owned) => owned.uuid === byUuid && canDeconstructItem(owned));
    if (matchedByUuid) return matchedByUuid;
  }

  return actor.items.find((owned) => itemsMatchForDeconstruction(referenceItem, owned) && canDeconstructItem(owned)) ?? null;
}

export function canDeconstructItem(item) {
  if (!item || isRecipeItem(item)) return false;
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor") return false;
  if (!game.user?.isGM && !actor.isOwner) return false;
  if (!game.user?.isGM && !setting("allowPlayerCrafting")) return false;
  if (getItemQuantity(item) <= 0) return false;
  const recipe = findRecipeForOutputItemSync(item);
  return Boolean(recipe && hasRecipeDeconstruction(recipe));
}

export async function deconstructItem(actor, item, options = {}) {
  if (!actor || !item) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
    return null;
  }

  if (item.parent?.id !== actor.id) actor = item.parent ?? actor;

  if (!game.user?.isGM && !actor?.isOwner) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActorPermission"));
    return null;
  }

  if (!game.user?.isGM && !setting("allowPlayerCrafting")) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.PlayerCraftingDisabled"));
    return null;
  }

  const recipe = await findRecipeForOutputItem(item);
  if (!recipe || !hasRecipeDeconstruction(recipe)) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Deconstruct.NoRecipe"));
    return null;
  }

  const previewPlan = getRefundPlan(item, recipe);
  if (!options.skipConfirm) {
    const confirmed = await confirmDeconstruction(item, recipe, previewPlan.refundMaterials);
    if (!confirmed) return null;
  }

  const consumedItem = {
    name: item.name,
    img: item.img,
    qty: 1
  };
  const refundOperations = [];
  const recovered = [];
  let operationLock = null;
  let sourceSnapshot = null;
  let lockedItem = null;

  try {
    operationLock = await acquireOperationLock();
    lockedItem = findActorItem(actor, item.id);
    if (!lockedItem || getItemQuantity(lockedItem) <= 0) {
      throw new Error("The deconstruction source item changed before the operation lock was acquired.");
    }

    // Recompute under the shared economy lock so another client cannot consume
    // the same source quantity or finite recovery pool between preview and mutation.
    const refundPlan = getRefundPlan(lockedItem, recipe);
    const refundMaterials = refundPlan.refundMaterials;
    sourceSnapshot = snapshotItem(lockedItem);

    const consumeResult = await consumeOwnedItemDocument(lockedItem, 1);
    if (!consumeResult?.ok) {
      throw new Error(`Could not remove deconstructed item: ${consumeResult?.reason || "unknown"}`);
    }

    await persistGeneratedRefundState(lockedItem, recipe, refundPlan);

    for (const material of refundMaterials) {
      const existing = getMatchingOwnedMaterialItems(actor, material)[0] ?? null;
      const existingSnapshot = snapshotItem(existing);
      const recoveredItem = await addOwnedMaterialQuantity(actor, material, material.qty);

      refundOperations.push({
        snapshot: existingSnapshot,
        createdItemId: recoveredItem && (!existing || recoveredItem.id !== existing.id) ? recoveredItem.id : null
      });

      recovered.push({
        ...material,
        actorId: actor.uuid || actor.id,
        actorName: actor.name || "",
        actorImg: actor.img || "icons/svg/mystery-man.svg",
        item: recoveredItem
      });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Deconstruction transaction failed`, error);
    if (sourceSnapshot) {
      const rollback = await rollbackDeconstruction(actor, sourceSnapshot, refundOperations);
      if (!rollback.ok) {
        console.error(`${MODULE_ID} | Deconstruction rollback was incomplete`, rollback.errors);
      }
    }
    ui.notifications.warn(game.i18n.localize("MKSDC.Deconstruct.CouldNotRemoveItem"));
    return null;
  } finally {
    if (operationLock?.release) {
      try {
        await operationLock.release();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to release deconstruction economy lock`, error);
      }
    }
  }

  await postCraftingChatCard(actor, {
    actor,
    recipe,
    recipeItem: { name: consumedItem.name, img: consumedItem.img, type: lockedItem?.type || item.type },
    requirements: { missing: [] },
    outcome: "deconstructed",
    outcomeLabel: game.i18n.localize("MKSDC.Outcome.Deconstructed"),
    deconstructedItem: consumedItem,
    refunded: recovered,
    consumed: [],
    createdItem: null,
    notes: []
  });

  ui.notifications.info(game.i18n.format("MKSDC.Deconstruct.Complete", { name: consumedItem.name }));
  return { actor, recipe, item: consumedItem, recovered };
}

function getItemIdFromElement(element) {
  let node = element instanceof HTMLElement ? element : null;
  while (node) {
    const dataset = node.dataset ?? {};
    const id = dataset.itemId || dataset.documentId || dataset.entityId || dataset.id;
    if (id) return String(id).trim();
    node = node.parentElement;
  }
  return "";
}

function getItemUuidFromElement(element) {
  let node = element instanceof HTMLElement ? element : null;
  while (node) {
    const dataset = node.dataset ?? {};
    const uuid = dataset.itemUuid || dataset.uuid || dataset.documentUuid;
    if (uuid) return String(uuid).trim();
    node = node.parentElement;
  }
  return "";
}

export function getOwnedItemFromContextElement(actor, target) {
  const element = target?.[0] ?? target?.currentTarget ?? target;
  if (!actor || !(element instanceof HTMLElement)) return null;

  const uuid = getItemUuidFromElement(element);
  if (uuid) {
    const item = actor.items?.find((owned) => owned.uuid === uuid);
    if (item) return item;
  }

  const id = getItemIdFromElement(element);
  if (!id) return null;
  return actor.items?.get?.(id) ?? actor.items?.find?.((owned) => owned.id === id) ?? null;
}
