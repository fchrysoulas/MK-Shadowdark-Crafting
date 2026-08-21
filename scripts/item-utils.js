import { FLAGS, ITEM_TYPE_ALIASES, MODULE_ID, SHADOWDARK_V350_ITEM_TYPES } from "./constants.js";
import { resolveRecipeOutputDefinition } from "./output-definition.js";
import { setting } from "./settings.js";

export function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function getSystemPath(document, paths) {
  for (const path of paths) {
    const value = foundry.utils.getProperty(document, path);
    if (value !== undefined && value !== null) return { path, value };
  }
  return { path: null, value: undefined };
}

export function getItemQuantity(item) {
  const candidates = [
    "system.quantity",
    "system.qty",
    "system.amount",
    "system.count",
    "system.stack.value",
    "system.uses.value"
  ];

  const found = getSystemPath(item, candidates);
  if (found.value === undefined) return 1;

  const qty = Number(found.value);
  if (!Number.isFinite(qty)) return 1;
  return qty;
}

export function getItemQuantityPath(item) {
  const candidates = [
    "system.quantity",
    "system.qty",
    "system.amount",
    "system.count",
    "system.stack.value",
    "system.uses.value"
  ];

  return getSystemPath(item, candidates).path;
}

export function findOwnedItemsByName(actor, name) {
  if (!actor || !name) return [];
  const target = normalizeName(name);
  if (!target) return [];
  return Array.from(actor.items ?? []).filter((item) => normalizeName(item.name) === target);
}

export function findOwnedItemByName(actor, name) {
  return findOwnedItemsByName(actor, name)[0] ?? null;
}

export function findOwnedItemByUuid(actor, uuid) {
  if (!actor || !uuid) return null;
  const target = String(uuid || "").trim();
  if (!target) return null;

  return actor.items?.find((item) => item.uuid === target) ?? null;
}

export function findOwnedItemsForMaterial(actor, material) {
  if (!actor || !material) return [];
  const byUuid = findOwnedItemByUuid(actor, material.uuid);
  if (byUuid) return [byUuid];
  return findOwnedItemsByName(actor, material.name);
}

export function findOwnedItemForMaterial(actor, material) {
  return findOwnedItemsForMaterial(actor, material)[0] ?? null;
}

export function getOwnedItemQuantity(actor, name) {
  return findOwnedItemsByName(actor, name)
    .reduce((total, item) => total + Math.max(0, Number(getItemQuantity(item)) || 0), 0);
}

export function getOwnedMaterialQuantity(actor, material) {
  return findOwnedItemsForMaterial(actor, material)
    .reduce((total, item) => total + Math.max(0, Number(getItemQuantity(item)) || 0), 0);
}

export function getActorResourceId(actor) {
  return String(actor?.uuid || actor?.id || actor?.name || "").trim();
}

function canUseActorResources(actor) {
  if (!actor) return false;
  return Boolean(game.user?.isGM || actor.isOwner);
}

function isSceneCharacterActor(actor, primaryActor = null) {
  if (!actor) return false;
  if (primaryActor && getActorResourceId(actor) === getActorResourceId(primaryActor)) return true;

  const type = String(actor.type || "").toLowerCase();
  if (!type) return true;
  return ["character", "pc", "player"].includes(type);
}

function addResourceActor(map, actor, primaryActor = null, sourceLabel = "") {
  if (!actor) return;
  if (!canUseActorResources(actor)) return;
  if (!isSceneCharacterActor(actor, primaryActor)) return;

  const id = getActorResourceId(actor);
  if (!id || map.has(id)) return;

  map.set(id, {
    id,
    actor,
    name: actor.name || game.i18n.localize("MKSDC.App.UnknownActor"),
    img: actor.img || "icons/svg/mystery-man.svg",
    primary: primaryActor ? id === getActorResourceId(primaryActor) : false,
    sourceLabel
  });
}

export function getAvailableResourceActors(primaryActor = null) {
  const actors = new Map();
  addResourceActor(actors, primaryActor, primaryActor, game.i18n.localize("MKSDC.App.Crafter"));

  const tokenPlaceables = Array.isArray(canvas?.tokens?.placeables) ? canvas.tokens.placeables : [];
  for (const token of tokenPlaceables) {
    if (!game.user?.isGM && token.document?.hidden) continue;
    addResourceActor(actors, token.actor, primaryActor, token.name || token.actor?.name || "");
  }

  const sceneTokens = canvas?.scene?.tokens?.contents ?? canvas?.scene?.tokens ?? [];
  for (const tokenDoc of sceneTokens) {
    if (!game.user?.isGM && tokenDoc.hidden) continue;
    addResourceActor(actors, tokenDoc.actor, primaryActor, tokenDoc.name || tokenDoc.actor?.name || "");
  }

  return Array.from(actors.values()).sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), game.i18n.lang, { sensitivity: "base", numeric: true });
  });
}

export function getResourceActorsFromIds(primaryActor = null, actorIds = []) {
  const idSet = new Set((actorIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  if (!idSet.size) return [];

  return getAvailableResourceActors(primaryActor)
    .filter((entry) => idSet.has(entry.id))
    .map((entry) => entry.actor);
}

export function normalizeResourceActors(primaryActor = null, resourceActors = null) {
  const list = Array.isArray(resourceActors) ? resourceActors : [primaryActor];
  const map = new Map();

  for (const actor of list) {
    if (!actor || !canUseActorResources(actor)) continue;
    const id = getActorResourceId(actor);
    if (id && !map.has(id)) map.set(id, actor);
  }

  return Array.from(map.values());
}

export function getOwnedMaterialSourceRows(resourceActors, material) {
  return normalizeResourceActors(null, resourceActors).flatMap((actor) => {
    return findOwnedItemsForMaterial(actor, material).map((item) => ({
      actor,
      actorId: getActorResourceId(actor),
      actorName: actor.name || "",
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      item,
      itemId: item.id,
      itemUuid: item.uuid || "",
      qty: Math.max(0, Number(getItemQuantity(item)) || 0)
    }));
  }).filter((row) => row.qty > 0);
}

export function getOwnedMaterialQuantityForActors(resourceActors, material) {
  const sourceRows = getOwnedMaterialSourceRows(resourceActors, material);
  const actorMap = new Map();

  for (const row of sourceRows) {
    const current = actorMap.get(row.actorId) || {
      actorId: row.actorId,
      actorName: row.actorName,
      actorImg: row.actorImg,
      qty: 0
    };
    current.qty += row.qty;
    actorMap.set(row.actorId, current);
  }

  return {
    qty: sourceRows.reduce((total, row) => total + row.qty, 0),
    sources: Array.from(actorMap.values())
  };
}

export function getBasicMaterialTotalsForActors(resourceActors, materials = []) {
  const map = new Map();
  const seen = new Set();

  for (const material of materials) {
    if (!material?.name) continue;

    const type = resolveItemType(material.type || "Basic", "Basic");
    if (normalizeName(type) !== "basic") continue;

    const key = `${normalizeName(material.name)}|${normalizeName(type)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const owned = getOwnedMaterialQuantityForActors(resourceActors, material);
    if (owned.qty <= 0) continue;

    const current = map.get(key) || {
      name: String(material.name || "").trim(),
      type,
      img: material.img || "icons/svg/item-bag.svg",
      qty: 0
    };
    current.qty += owned.qty;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => {
    return String(a.name).localeCompare(String(b.name), game.i18n.lang, { sensitivity: "base", numeric: true });
  });
}

export function findOwnedItemByNameForActors(resourceActors, name) {
  for (const actor of normalizeResourceActors(null, resourceActors)) {
    const item = findOwnedItemByName(actor, name);
    if (item) return { actor, item };
  }
  return null;
}

export function getGoldInfoForActors(resourceActors) {
  const sources = normalizeResourceActors(null, resourceActors).map((actor) => {
    const info = getGoldInfo(actor);
    return {
      actor,
      actorId: getActorResourceId(actor),
      actorName: actor.name || "",
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      path: info.path,
      amount: info.amount
    };
  }).filter((row) => row.path);

  return {
    path: sources.length ? "multiple" : null,
    amount: sources.reduce((total, row) => total + row.amount, 0),
    sources: sources.map((row) => ({
      actorId: row.actorId,
      actorName: row.actorName,
      actorImg: row.actorImg,
      amount: row.amount
    }))
  };
}

export async function consumeOwnedMaterialFromActors(resourceActors, material, qty) {
  let remaining = Math.max(0, Number(qty) || 0);
  const consumed = [];

  for (const source of getOwnedMaterialSourceRows(resourceActors, material)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, source.qty);
    if (take <= 0) continue;

    const result = await consumeItemDocument(source.actor, source.item, material?.name ?? "", take);
    consumed.push({
      ...result,
      actorId: source.actorId,
      actorName: source.actorName,
      actorImg: source.actorImg,
      itemId: source.itemId,
      itemUuid: source.itemUuid
    });
    if (result?.ok) remaining -= take;
  }

  return {
    ok: remaining <= 0,
    requested: Math.max(0, Number(qty) || 0),
    remaining,
    consumed
  };
}

async function consumeItemDocument(actor, item, name, qty) {
  if (!item) return { ok: false, reason: "missing", name, qty };

  const current = getItemQuantity(item);
  const consume = Math.max(0, Number(qty) || 0);
  if (current < consume) return { ok: false, reason: "insufficient", name, qty, current };

  const next = current - consume;
  const quantityPath = getItemQuantityPath(item);

  if (next <= 0) {
    await actor.deleteEmbeddedDocuments("Item", [item.id]);
    return { ok: true, deleted: true, name, qty: consume };
  }

  if (!quantityPath) {
    return { ok: false, reason: "noQuantityPath", name, qty: consume };
  }

  await item.update({ [quantityPath]: next });
  return { ok: true, deleted: false, name, qty: consume, remaining: next };
}

export async function consumeOwnedItem(actor, name, qty) {
  const item = findOwnedItemByName(actor, name);
  return consumeItemDocument(actor, item, name, qty);
}

export async function consumeOwnedMaterial(actor, material, qty) {
  let remaining = Math.max(0, Number(qty) || 0);
  const consumed = [];

  for (const item of findOwnedItemsForMaterial(actor, material)) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(getItemQuantity(item)) || 0);
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    const result = await consumeItemDocument(actor, item, material?.name ?? "", take);
    consumed.push(result);
    if (result?.ok) remaining -= take;
  }

  return {
    ok: remaining <= 0,
    requested: Math.max(0, Number(qty) || 0),
    remaining,
    consumed
  };
}

export function getGoldInfo(actor) {
  const candidates = [
    "system.coins.gp",
    "system.coins.gold",
    "system.currency.gp",
    "system.currency.gold",
    "system.money.gp",
    "system.money.gold",
    "system.gp",
    "system.gold"
  ];

  const found = getSystemPath(actor, candidates);
  const amount = Number(found.value ?? 0);
  return {
    path: found.path,
    amount: Number.isFinite(amount) ? amount : 0
  };
}

export async function consumeGold(actor, amount) {
  const cost = Math.max(0, Number(amount) || 0);
  if (!cost) return { ok: true, amount: 0 };

  const info = getGoldInfo(actor);
  if (!info.path) return { ok: false, reason: "noGoldPath", amount: cost };
  if (info.amount < cost) return { ok: false, reason: "insufficientGold", amount: cost, current: info.amount };

  await actor.update({ [info.path]: info.amount - cost });
  return { ok: true, amount: cost, remaining: info.amount - cost };
}

export async function consumeGoldFromActors(resourceActors, amount) {
  let remaining = Math.max(0, Number(amount) || 0);
  const consumed = [];

  for (const actor of normalizeResourceActors(null, resourceActors)) {
    if (remaining <= 0) break;
    const info = getGoldInfo(actor);
    if (!info.path || info.amount <= 0) continue;

    const take = Math.min(remaining, info.amount);
    if (take <= 0) continue;

    const result = await consumeGold(actor, take);
    consumed.push({
      ...result,
      actorId: getActorResourceId(actor),
      actorName: actor.name || "",
      actorImg: actor.img || "icons/svg/mystery-man.svg"
    });
    if (result?.ok) remaining -= take;
  }

  return {
    ok: remaining <= 0,
    requested: Math.max(0, Number(amount) || 0),
    remaining,
    consumed
  };
}

export function getAbilityMod(actor, ability) {
  const key = String(ability || "int").toLowerCase();
  const upper = key.toUpperCase();

  const paths = [
    `system.abilities.${key}.mod`,
    `system.abilities.${key}.modifier`,
    `system.abilities.${key}.value`,
    `system.abilities.${upper}.mod`,
    `system.stats.${key}.mod`,
    `system.stats.${key}.modifier`,
    `system.stats.${key}.value`,
    `system.attributes.${key}.mod`,
    `system.attributes.${key}.modifier`,
    `system.${key}.mod`,
    `system.${key}.modifier`,
    `system.${key}.value`
  ];

  const found = getSystemPath(actor, paths);
  const raw = Number(found.value ?? 0);
  if (!Number.isFinite(raw)) return 0;

  if (String(found.path || "").endsWith(".value") && raw >= 3 && raw <= 30) {
    return Math.floor((raw - 10) / 2);
  }

  if (Math.abs(raw) <= 10) return raw;
  return Math.floor((raw - 10) / 2);
}

function addTypeCandidates(set, value) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => addTypeCandidates(set, entry));
    return;
  }

  if (value instanceof Set) {
    value.forEach((entry) => addTypeCandidates(set, entry));
    return;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach((entry) => addTypeCandidates(set, entry));
    return;
  }

  const type = String(value).trim();
  if (type) set.add(type);
}

export function getAvailableItemTypes() {
  const types = new Set();
  const config = globalThis.CONFIG ?? {};

  addTypeCandidates(types, globalThis.game?.system?.documentTypes?.Item);
  addTypeCandidates(types, config.Item?.documentClass?.metadata?.types);
  addTypeCandidates(types, config.Item?.typeLabels);
  addTypeCandidates(types, config.Item?.dataModels);
  addTypeCandidates(types, config.SHADOWDARK?.DEFAULTS?.ITEM_IMAGES);

  // Runtime system metadata is authoritative. The hard-coded list is only a
  // compatibility fallback for environments where no item-type metadata is exposed.
  if (types.size === 0) {
    SHADOWDARK_V350_ITEM_TYPES.forEach((type) => types.add(type));
  }

  const typeList = Array.from(types).filter(Boolean);
  const order = new Map(SHADOWDARK_V350_ITEM_TYPES.map((type, index) => [type, index]));

  return typeList.sort((a, b) => {
    const aOrder = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a).localeCompare(String(b));
  });
}

export function resolveItemType(value, fallback = "Basic") {
  const available = getAvailableItemTypes();
  const fallbackResolved = ITEM_TYPE_ALIASES[normalizeName(fallback)] ?? fallback ?? "Basic";
  const raw = String(value || fallbackResolved || "Basic").trim();
  const aliased = ITEM_TYPE_ALIASES[normalizeName(raw)] ?? raw;

  if (!available.length) return aliased || "Basic";
  if (available.includes(aliased)) return aliased;

  const caseMatch = available.find((type) => normalizeName(type) === normalizeName(aliased));
  if (caseMatch) return caseMatch;

  if (available.includes(fallbackResolved)) return fallbackResolved;

  const fallbackCaseMatch = available.find((type) => normalizeName(type) === normalizeName(fallbackResolved));
  if (fallbackCaseMatch) return fallbackCaseMatch;

  if (available.includes("Basic")) return "Basic";
  return available[0];
}

export function getDefaultItemType(preferred = null) {
  let configured = preferred;
  if (!configured) {
    try {
      configured = setting("recipeItemType");
    } catch (_error) {
      configured = "Basic";
    }
  }
  return resolveItemType(configured || "Basic", "Basic");
}

export function setItemQuantityOnData(data, qty) {
  const amount = Math.max(1, Number(qty || 1));
  const candidates = [
    "system.quantity",
    "system.qty",
    "system.amount",
    "system.count",
    "system.stack.value",
    "system.uses.value"
  ];

  const existing = getSystemPath(data, candidates);
  const path = existing.path || "system.quantity";
  foundry.utils.setProperty(data, path, amount);
  return data;
}

function cloneItemSourceForMaterial(material = {}) {
  const data = {
    name: String(material.name || game.i18n.localize("MKSDC.Crafting.NewCraftedItem") || "Recovered Material").trim(),
    type: resolveItemType(material.type || "Basic", "Basic"),
    img: String(material.img || "icons/svg/item-bag.svg").trim(),
    system: {}
  };
  return data;
}

export async function addOwnedItemQuantity(actor, itemData, qty = 1) {
  if (!actor) return null;

  const amount = Math.max(1, Number(qty || 1));
  const material = {
    name: itemData?.name,
    uuid: itemData?.uuid,
    type: itemData?.type,
    img: itemData?.img
  };

  const existing = findOwnedItemForMaterial(actor, material) || findOwnedItemByName(actor, itemData?.name);
  if (existing) {
    const quantityPath = getItemQuantityPath(existing);
    if (quantityPath) {
      const current = getItemQuantity(existing);
      await existing.update({ [quantityPath]: current + amount });
      return existing;
    }
  }

  let data = null;
  const uuid = String(itemData?.uuid || "").trim();
  if (uuid) {
    try {
      const source = await fromUuid(uuid);
      if (source) data = source.toObject();
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not load recovered material UUID`, uuid, error);
    }
  }

  if (!data) data = cloneItemSourceForMaterial(itemData);
  delete data._id;
  data.name = String(itemData?.name || data.name || "Recovered Material").trim();
  data.type = resolveItemType(itemData?.type || data.type || "Basic", "Basic");
  data.img = String(itemData?.img || data.img || "icons/svg/item-bag.svg").trim();
  setItemQuantityOnData(data, amount);

  const created = await actor.createEmbeddedDocuments("Item", [data]);
  return created?.[0] ?? null;
}

export async function consumeOwnedItemDocument(item, qty = 1) {
  const actor = item?.parent;
  if (!actor) return { ok: false, reason: "noActor", name: item?.name || "", qty };
  return consumeItemDocument(actor, item, item.name, qty);
}

export async function createActorItemFromRecipe(actor, recipe, resultInfo = {}) {
  const defaultOutputImg = "icons/svg/item-bag.svg";
  const outputImg = String(recipe.outputImg || "").trim();
  const resolvedOutput = await resolveRecipeOutputDefinition(recipe, {
    resolveUuid: (uuid) => fromUuid(uuid),
    clone: (value) => foundry.utils.deepClone(value),
    onResolveError: (error, uuid) => console.warn(`${MODULE_ID} | Could not load output UUID`, uuid, error)
  });
  let data = resolvedOutput.data;

  if (!data) {
    data = {
      name: recipe.outputName || game.i18n.localize("MKSDC.Crafting.NewCraftedItem"),
      type: getDefaultItemType(recipe.outputType || "Basic"),
      img: outputImg || "icons/tools/hand/hammer-and-nail.webp",
      system: {}
    };
  }

  delete data._id;
  data.name = recipe.outputName || data.name;
  if (outputImg && outputImg !== defaultOutputImg) data.img = outputImg;
  setItemQuantityOnData(data, recipe.outputQty || 1);

  if (recipe.outputType) {
    data.type = resolveItemType(recipe.outputType, data.type || "Basic");
  }

  const createdQty = Math.max(1, Number(resultInfo.createdQty || recipe.outputQty || 1));
  const consumedMaterials = Array.isArray(resultInfo.consumedMaterials)
    ? foundry.utils.deepClone(resultInfo.consumedMaterials)
    : [];
  const recoverableMaterials = consumedMaterials
    .map((material) => ({
      ...foundry.utils.deepClone(material),
      qty: Math.ceil(Math.max(0, Number(material?.qty) || 0) / 2)
    }))
    .filter((material) => material.name && material.qty > 0);

  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAGS.CRAFTED}`, {
    recipeId: resultInfo.recipeId || recipe.id || "",
    recipeBookId: resultInfo.recipeBookId || recipe.bookId || "",
    recipeName: resultInfo.recipeName || recipe.outputName || "",
    createdQty,
    remainingQty: createdQty,
    consumedMaterials,
    recoverableMaterials,
    recipeSnapshot: resultInfo.recipeSnapshot ? foundry.utils.deepClone(resultInfo.recipeSnapshot) : null,
    crafterName: actor.name,
    quality: resultInfo.quality || "standard",
    createdAt: new Date().toISOString()
  });

  const created = await actor.createEmbeddedDocuments("Item", [data]);
  return created?.[0] ?? null;
}