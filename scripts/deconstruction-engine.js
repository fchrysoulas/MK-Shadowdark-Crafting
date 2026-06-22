import { FLAGS, MODULE_ID } from "./constants.js";
import { setting } from "./settings.js";
import { postCraftingChatCard } from "./chat.js";
import { addOwnedItemQuantity, consumeOwnedItemDocument, getItemQuantity, normalizeName } from "./item-utils.js";
import { getRecipeById, getRecipeDeconstructMaterials, getRecipeEntriesForActor, hasRecipeDeconstruction, isRecipeItem, sanitizeRecipeData } from "./recipe-utils.js";

function getCraftedFlag(item) {
  return item?.getFlag?.(MODULE_ID, FLAGS.CRAFTED) ?? null;
}

function sameText(a, b) {
  return normalizeName(a) === normalizeName(b);
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
  if (byRecipeId) {
    const found = entries.find((entry) => String(entry.recipe?.id || entry.id) === byRecipeId);
    if (found?.recipe) return found.recipe;
  }

  const exact = entries.find((entry) => recipeMatchesItem(entry.recipe, item));
  return exact?.recipe ?? null;
}

async function findRecipeForOutputItem(item) {
  const crafted = getCraftedFlag(item);
  const byRecipeId = String(crafted?.recipeId || "").trim();
  if (byRecipeId) {
    const recipe = await getRecipeById(byRecipeId);
    if (recipe) return recipe;
  }

  return findRecipeForOutputItemSync(item);
}

function aggregateMaterials(materials = []) {
  const map = new Map();

  for (const material of materials) {
    const qty = Math.max(0, Number(material?.qty || 0));
    const name = String(material?.name || "").trim();
    if (!name || !qty) continue;

    const uuid = String(material?.uuid || "").trim();
    const type = String(material?.type || "").trim();
    const img = String(material?.img || "icons/svg/item-bag.svg").trim();
    const key = uuid || `${name.toLocaleLowerCase()}|${type.toLocaleLowerCase()}`;
    const current = map.get(key) || { name, uuid, type, img, qty: 0 };
    current.qty += qty;
    map.set(key, current);
  }

  return Array.from(map.values());
}

function getRecipeDefaultMaterials(recipe) {
  const choices = [];
  for (const group of recipe?.materialGroups ?? []) {
    const material = group?.alternatives?.[0];
    if (material) choices.push(material);
  }
  return aggregateMaterials(choices);
}

function getActualConsumedMaterials(item, recipe) {
  const crafted = getCraftedFlag(item);
  if (Array.isArray(crafted?.consumedMaterials) && crafted.consumedMaterials.length) {
    return aggregateMaterials(crafted.consumedMaterials);
  }

  return getRecipeDefaultMaterials(recipe);
}

function getCreatedQty(item, recipe) {
  const crafted = getCraftedFlag(item);
  const createdQty = Number(crafted?.createdQty || recipe?.outputQty || 1);
  return Math.max(1, Number.isFinite(createdQty) ? createdQty : 1);
}

function getRefundMaterials(_item, recipe) {
  return getRecipeDeconstructMaterials(recipe);
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

  return Dialog.confirm({
    title: game.i18n.format("MKSDC.Deconstruct.Title", { name: item.name }),
    content: `
      <div class="mk-sdc mk-sdc-deconstruct-dialog">
        <p>${game.i18n.format("MKSDC.Deconstruct.Content", { name: escapeHtml(item.name), recipe: escapeHtml(recipe.outputName) })}</p>
        ${materialList}
      </div>`,
    yes: () => true,
    no: () => false,
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
    const matchedByUuid = actor.items.find((item) => item.uuid === byUuid && canDeconstructItem(item));
    if (matchedByUuid) return matchedByUuid;
  }

  return actor.items.find((item) => itemsMatchForDeconstruction(referenceItem, item) && canDeconstructItem(item)) ?? null;
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

  const refundMaterials = getRefundMaterials(item, recipe);
  if (!options.skipConfirm) {
    const confirmed = await confirmDeconstruction(item, recipe, refundMaterials);
    if (!confirmed) return null;
  }

  const consumedItem = {
    name: item.name,
    img: item.img,
    qty: 1
  };

  const consumeResult = await consumeOwnedItemDocument(item, 1);
  if (!consumeResult?.ok) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Deconstruct.CouldNotRemoveItem"));
    return null;
  }

  const recovered = [];
  for (const material of refundMaterials) {
    const recoveredItem = await addOwnedItemQuantity(actor, material, material.qty);
    recovered.push({
      ...material,
      actorId: actor.uuid || actor.id,
      actorName: actor.name || "",
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      item: recoveredItem
    });
  }

  await postCraftingChatCard(actor, {
    actor,
    recipe,
    recipeItem: { name: consumedItem.name, img: consumedItem.img, type: item.type },
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
