import {
  getActorResourceId,
  getItemQuantity,
  normalizeName,
  normalizeResourceActors
} from "./item-utils.js";

function sourceKey(source) {
  return `${source.actorId}::${source.itemId}`;
}

function cloneLedger(ledger) {
  return new Map(ledger);
}

function itemSourceMatchesUuid(item, uuid) {
  const target = String(uuid || "").trim();
  if (!target || !item) return false;
  if (String(item.uuid || "").trim() === target) return true;

  const coreSource = String(item.getFlag?.("core", "sourceId") || "").trim();
  if (coreSource === target) return true;

  const compendiumSource = String(item._stats?.compendiumSource || "").trim();
  if (compendiumSource === target) return true;

  const duplicateSource = String(item._stats?.duplicateSource || "").trim();
  return duplicateSource === target;
}

function materialMatchesItem(item, material = {}) {
  if (!item || !material) return false;

  const materialUuid = String(material.uuid || "").trim();
  if (materialUuid && !itemSourceMatchesUuid(item, materialUuid)) return false;

  const targetName = normalizeName(material.name);
  if (targetName && normalizeName(item.name) !== targetName) return false;

  const targetType = normalizeName(material.type);
  if (targetType && normalizeName(item.type) !== targetType) return false;

  return true;
}

export function getMaterialAvailability(resourceActors, material = {}) {
  const actorSources = [];
  const itemSources = [];

  for (const actor of normalizeResourceActors(null, resourceActors)) {
    const actorId = getActorResourceId(actor);
    let actorQty = 0;

    for (const item of actor.items || []) {
      if (!materialMatchesItem(item, material)) continue;
      const qty = Math.max(0, Number(getItemQuantity(item)) || 0);
      if (qty <= 0) continue;

      actorQty += qty;
      itemSources.push({
        actorId,
        actorName: actor.name || "",
        actorImg: actor.img || "icons/svg/mystery-man.svg",
        itemId: item.id,
        itemUuid: item.uuid || "",
        itemName: item.name || material.name || "",
        qty
      });
    }

    if (actorQty > 0) {
      actorSources.push({
        actorId,
        actorName: actor.name || "",
        actorImg: actor.img || "icons/svg/mystery-man.svg",
        qty: actorQty
      });
    }
  }

  return {
    qty: itemSources.reduce((total, source) => total + source.qty, 0),
    sources: actorSources,
    itemSources
  };
}

function prepareGroups(resourceActors, materialGroups = []) {
  const ledger = new Map();
  const groups = (materialGroups || []).map((group, groupIndex) => {
    const alternatives = (group?.alternatives || []).map((material, alternativeIndex) => {
      const availability = getMaterialAvailability(resourceActors, material);
      const sources = availability.itemSources.map((source) => {
        const row = {
          actorId: source.actorId,
          actorName: source.actorName,
          actorImg: source.actorImg,
          itemId: source.itemId,
          itemUuid: source.itemUuid,
          itemName: source.itemName,
          availableQty: Math.max(0, Number(source.qty) || 0)
        };

        const key = sourceKey(row);
        if (!ledger.has(key)) ledger.set(key, row.availableQty);
        return row;
      });

      return {
        groupIndex,
        alternativeIndex,
        material,
        sources
      };
    });

    return {
      id: group?.id || "",
      groupIndex,
      alternatives
    };
  });

  return { groups, ledger };
}

function reserveAlternative(alternative, ledger) {
  let remaining = Math.max(0, Number(alternative?.material?.qty) || 0);
  const allocations = [];

  for (const source of alternative?.sources || []) {
    if (remaining <= 0) break;
    const key = sourceKey(source);
    const available = Math.max(0, Number(ledger.get(key)) || 0);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;

    allocations.push({
      actorId: source.actorId,
      actorName: source.actorName,
      actorImg: source.actorImg,
      itemId: source.itemId,
      itemUuid: source.itemUuid,
      itemName: source.itemName,
      qty: take,
      material: {
        name: String(alternative.material?.name || "").trim(),
        uuid: String(alternative.material?.uuid || "").trim(),
        type: String(alternative.material?.type || "").trim(),
        img: String(alternative.material?.img || "icons/svg/item-bag.svg").trim()
      }
    });

    ledger.set(key, available - take);
    remaining -= take;
  }

  return {
    ok: remaining <= 0,
    remaining,
    allocations
  };
}

/**
 * Build one globally valid allocation for all material requirement groups.
 * Alternatives are tried in recipe order and quantities are reserved from a
 * shared per-item ledger. Backtracking allows later groups to force an earlier
 * group onto a different substitute when necessary.
 */
export function planMaterialGroups(resourceActors, materialGroups = []) {
  const prepared = prepareGroups(resourceActors, materialGroups);
  let deepestFailure = 0;

  function search(groupIndex, ledger, selections) {
    if (groupIndex >= prepared.groups.length) {
      return { ok: true, selections, ledger };
    }

    deepestFailure = Math.max(deepestFailure, groupIndex);
    const group = prepared.groups[groupIndex];

    for (const alternative of group.alternatives) {
      const nextLedger = cloneLedger(ledger);
      const reserved = reserveAlternative(alternative, nextLedger);
      if (!reserved.ok) continue;

      const selection = {
        groupIndex,
        alternativeIndex: alternative.alternativeIndex,
        material: alternative.material,
        allocations: reserved.allocations
      };
      const result = search(groupIndex + 1, nextLedger, [...selections, selection]);
      if (result.ok) return result;
    }

    return { ok: false, selections, ledger };
  }

  const result = search(0, prepared.ledger, []);
  return {
    ok: result.ok,
    selections: result.ok ? result.selections : [],
    failedGroupIndex: result.ok ? -1 : Math.min(deepestFailure, Math.max(0, prepared.groups.length - 1))
  };
}

/**
 * Reduce a full-cost allocation to the quantity actually consumed by the
 * outcome (for example half cost on failure or critical success) while keeping
 * the same actors/stacks and deterministic source order.
 */
export function sliceMaterialAllocations(allocations = [], qty = 0) {
  let remaining = Math.max(0, Number(qty) || 0);
  const result = [];

  for (const allocation of allocations || []) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(allocation?.qty) || 0);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    result.push({ ...allocation, qty: take });
    remaining -= take;
  }

  return {
    ok: remaining <= 0,
    requested: Math.max(0, Number(qty) || 0),
    remaining,
    allocations: result
  };
}
