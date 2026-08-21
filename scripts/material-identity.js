import { MODULE_ID } from "./constants.js";
import {
  getItemQuantity,
  getItemQuantityPath,
  resolveItemType,
  setItemQuantityOnData
} from "./item-utils.js";

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function itemSourceUuids(item) {
  if (!item) return [];
  const values = [
    item.uuid,
    item.getFlag?.("core", "sourceId"),
    item._stats?.compendiumSource,
    item._stats?.duplicateSource
  ];
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function isActorOwnedItem(item) {
  return Boolean(item?.parent?.documentName === "Actor" || item?.actor?.documentName === "Actor");
}

/**
 * Pick the reusable source identity that should be persisted into a recipe.
 * Actor embedded UUIDs identify one inventory instance and are deliberately
 * discarded unless the item exposes a stable origin UUID.
 */
export function getStableMaterialUuid(item, droppedUuid = "") {
  if (!item) return "";

  const stableOrigin = [
    item.getFlag?.("core", "sourceId"),
    item._stats?.compendiumSource,
    item._stats?.duplicateSource
  ].map((value) => String(value || "").trim()).find(Boolean);
  if (stableOrigin) return stableOrigin;

  if (isActorOwnedItem(item)) return "";
  return String(droppedUuid || item.uuid || "").trim();
}

/**
 * UUID is authoritative when present. Without one, material identity is the
 * normalized name/type pair. This function is shared by consumption and refund
 * paths so they cannot disagree about what counts as the same material.
 */
export function materialMatchesItemIdentity(item, material = {}) {
  if (!item || !material) return false;

  const uuid = String(material.uuid || "").trim();
  if (uuid && !itemSourceUuids(item).includes(uuid)) return false;

  const name = normalize(material.name);
  if (name && normalize(item.name) !== name) return false;

  const type = normalize(material.type);
  if (type && normalize(item.type) !== type) return false;

  return true;
}

export function getMatchingOwnedMaterialItems(actor, material = {}) {
  if (!actor?.items) return [];
  return Array.from(actor.items).filter((item) => materialMatchesItemIdentity(item, material));
}

export function getMaterialIdentityFromItem(item, droppedUuid = "") {
  return {
    name: String(item?.name || "").trim(),
    uuid: getStableMaterialUuid(item, droppedUuid),
    type: String(item?.type || "").trim(),
    img: String(item?.img || "icons/svg/item-bag.svg").trim()
  };
}

function genericMaterialSource(material = {}) {
  return {
    name: String(material.name || "Recovered Material").trim() || "Recovered Material",
    type: resolveItemType(material.type || "Basic", "Basic"),
    img: String(material.img || "icons/svg/item-bag.svg").trim(),
    system: {}
  };
}

/**
 * Add a recovered material using the same identity rules as crafting.
 * A UUID-specific material never falls back to a same-name unrelated stack.
 */
export async function addOwnedMaterialQuantity(actor, material = {}, qty = 1) {
  if (!actor) return null;
  const amount = Math.max(1, Number(qty) || 1);

  const existing = getMatchingOwnedMaterialItems(actor, material)[0] ?? null;
  if (existing) {
    const quantityPath = getItemQuantityPath(existing);
    if (quantityPath) {
      const current = getItemQuantity(existing);
      await existing.update({ [quantityPath]: current + amount });
      return existing;
    }
  }

  let data = null;
  const uuid = String(material.uuid || "").trim();
  if (uuid) {
    try {
      const source = await fromUuid(uuid);
      if (source) data = source.toObject();
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not load recovered material source UUID`, uuid, error);
    }
  }

  if (!data) data = genericMaterialSource(material);
  delete data._id;
  data.name = String(material.name || data.name || "Recovered Material").trim();
  data.type = resolveItemType(material.type || data.type || "Basic", "Basic");
  data.img = String(material.img || data.img || "icons/svg/item-bag.svg").trim();
  setItemQuantityOnData(data, amount);

  const created = await actor.createEmbeddedDocuments("Item", [data]);
  return created?.[0] ?? null;
}
