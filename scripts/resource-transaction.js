import {
  getActorResourceId,
  getGoldInfo,
  getItemQuantity,
  getItemQuantityPath,
  normalizeResourceActors
} from "./item-utils.js";

function getOwnedItem(actor, itemId) {
  if (!actor || !itemId) return null;
  return actor.items?.get?.(itemId) ?? actor.items?.find?.((item) => item.id === itemId) ?? null;
}

function allocationKey(allocation) {
  return `${allocation.actorId}::${allocation.itemId}`;
}

function aggregateAllocations(allocations = []) {
  const map = new Map();
  for (const allocation of allocations || []) {
    const qty = Math.max(0, Number(allocation?.qty) || 0);
    if (!allocation?.actorId || !allocation?.itemId || qty <= 0) continue;
    const key = allocationKey(allocation);
    const current = map.get(key) || { ...allocation, qty: 0 };
    current.qty += qty;
    map.set(key, current);
  }
  return Array.from(map.values());
}

export class ResourceTransaction {
  constructor(resourceActors = []) {
    this.resourceActors = normalizeResourceActors(null, resourceActors);
    this.actorMap = new Map(this.resourceActors.map((actor) => [getActorResourceId(actor), actor]));
    this.itemSnapshots = new Map();
    this.goldSnapshots = new Map();
    this.closed = false;
  }

  _getActor(actorId) {
    return this.actorMap.get(String(actorId || "")) ?? null;
  }

  _snapshotItem(actor, item) {
    const key = `${getActorResourceId(actor)}::${item.id}`;
    if (this.itemSnapshots.has(key)) return;

    this.itemSnapshots.set(key, {
      actor,
      itemId: item.id,
      quantityPath: getItemQuantityPath(item),
      quantity: getItemQuantity(item),
      source: item.toObject()
    });
  }

  _snapshotGold(actor, path, amount) {
    const key = `${getActorResourceId(actor)}::${path}`;
    if (this.goldSnapshots.has(key)) return;
    this.goldSnapshots.set(key, { actor, path, amount });
  }

  validateMaterialAllocations(allocations = []) {
    const aggregated = aggregateAllocations(allocations);
    const resolved = [];

    for (const allocation of aggregated) {
      const actor = this._getActor(allocation.actorId);
      const item = getOwnedItem(actor, allocation.itemId);
      if (!actor || !item) {
        return {
          ok: false,
          reason: "missingItem",
          allocation
        };
      }

      const current = getItemQuantity(item);
      if (current < allocation.qty) {
        return {
          ok: false,
          reason: "insufficientMaterial",
          allocation,
          current
        };
      }

      if (current > allocation.qty && !getItemQuantityPath(item)) {
        return {
          ok: false,
          reason: "noQuantityPath",
          allocation,
          current
        };
      }

      resolved.push({ allocation, actor, item, current });
    }

    return { ok: true, resolved };
  }

  async consumeMaterialAllocations(allocations = []) {
    if (this.closed) throw new Error("Resource transaction is already closed.");

    const validation = this.validateMaterialAllocations(allocations);
    if (!validation.ok) return validation;

    const consumed = [];
    for (const entry of validation.resolved) {
      const { allocation, actor, item, current } = entry;
      this._snapshotItem(actor, item);

      const next = current - allocation.qty;
      const quantityPath = getItemQuantityPath(item);
      if (next <= 0) {
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
      } else {
        await item.update({ [quantityPath]: next });
      }

      consumed.push({
        ok: true,
        kind: "material",
        name: allocation.material?.name || allocation.itemName || item.name || "",
        uuid: allocation.material?.uuid || "",
        type: allocation.material?.type || item.type || "",
        img: allocation.material?.img || item.img || "icons/svg/item-bag.svg",
        qty: allocation.qty,
        actorId: allocation.actorId,
        actorName: actor.name || allocation.actorName || "",
        actorImg: actor.img || allocation.actorImg || "icons/svg/mystery-man.svg",
        itemId: allocation.itemId,
        deleted: next <= 0,
        remaining: Math.max(0, next)
      });
    }

    return { ok: true, consumed };
  }

  _planGold(amount) {
    let remaining = Math.max(0, Number(amount) || 0);
    const allocations = [];

    for (const actor of this.resourceActors) {
      if (remaining <= 0) break;
      const info = getGoldInfo(actor);
      if (!info.path || info.amount <= 0) continue;

      const take = Math.min(remaining, info.amount);
      if (take <= 0) continue;
      allocations.push({ actor, path: info.path, current: info.amount, qty: take });
      remaining -= take;
    }

    return {
      ok: remaining <= 0,
      requested: Math.max(0, Number(amount) || 0),
      remaining,
      allocations
    };
  }

  async consumeGold(amount = 0) {
    if (this.closed) throw new Error("Resource transaction is already closed.");
    const plan = this._planGold(amount);
    if (!plan.ok) return { ...plan, reason: "insufficientGold" };

    const consumed = [];
    for (const allocation of plan.allocations) {
      const { actor, path, current, qty } = allocation;
      this._snapshotGold(actor, path, current);
      await actor.update({ [path]: current - qty });
      consumed.push({
        ok: true,
        kind: "gold",
        name: game.i18n.localize("MKSDC.Gold"),
        qty,
        actorId: getActorResourceId(actor),
        actorName: actor.name || "",
        actorImg: actor.img || "icons/svg/mystery-man.svg",
        remaining: current - qty
      });
    }

    return { ok: true, consumed };
  }

  commit() {
    this.itemSnapshots.clear();
    this.goldSnapshots.clear();
    this.closed = true;
  }

  async rollback() {
    if (this.closed) return { ok: true, errors: [] };
    const errors = [];

    for (const snapshot of Array.from(this.goldSnapshots.values()).reverse()) {
      try {
        await snapshot.actor.update({ [snapshot.path]: snapshot.amount });
      } catch (error) {
        errors.push(error);
        console.error("mk-shadowdark-crafting | Failed to roll back gold", error);
      }
    }

    for (const snapshot of Array.from(this.itemSnapshots.values()).reverse()) {
      try {
        const current = getOwnedItem(snapshot.actor, snapshot.itemId);
        if (current) {
          if (snapshot.quantityPath) {
            await current.update({ [snapshot.quantityPath]: snapshot.quantity });
          }
        } else {
          await snapshot.actor.createEmbeddedDocuments("Item", [snapshot.source], { keepId: true });
        }
      } catch (error) {
        errors.push(error);
        console.error("mk-shadowdark-crafting | Failed to roll back item", error);
      }
    }

    this.itemSnapshots.clear();
    this.goldSnapshots.clear();
    this.closed = true;
    return { ok: errors.length === 0, errors };
  }
}
