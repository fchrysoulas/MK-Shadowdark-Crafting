function materialKey(material = {}) {
  const uuid = String(material.uuid || "").trim();
  if (uuid) return `uuid:${uuid}`;
  return `name:${String(material.name || "").trim().toLocaleLowerCase()}|type:${String(material.type || "").trim().toLocaleLowerCase()}`;
}

export function aggregateRefundMaterials(materials = []) {
  const map = new Map();

  for (const material of materials || []) {
    const name = String(material?.name || "").trim();
    const qty = Math.max(0, Number(material?.qty) || 0);
    if (!name || qty <= 0) continue;

    const normalized = {
      name,
      uuid: String(material?.uuid || "").trim(),
      type: String(material?.type || "").trim(),
      img: String(material?.img || "icons/svg/item-bag.svg").trim(),
      qty
    };

    const key = materialKey(normalized);
    const current = map.get(key) || { ...normalized, qty: 0 };
    current.qty += qty;
    map.set(key, current);
  }

  return Array.from(map.values());
}

export function buildRecoverablePool(consumedMaterials = []) {
  return aggregateRefundMaterials(consumedMaterials).map((material) => ({
    ...material,
    qty: Math.ceil(material.qty / 2)
  })).filter((material) => material.qty > 0);
}

function scalePoolForRemainingQuantity(pool, remainingQty, createdQty) {
  const safeCreatedQty = Math.max(1, Number(createdQty) || 1);
  const safeRemainingQty = Math.max(0, Math.min(safeCreatedQty, Number(remainingQty) || 0));
  if (safeRemainingQty >= safeCreatedQty) return aggregateRefundMaterials(pool);

  return aggregateRefundMaterials(pool).map((material) => ({
    ...material,
    qty: Math.floor(material.qty * safeRemainingQty / safeCreatedQty)
  })).filter((material) => material.qty > 0);
}

/**
 * Normalize a crafted batch into a finite remaining refund pool. For legacy
 * crafted stacks which have already lost quantity but never stored a pool, the
 * pool is scaled down conservatively so the migration cannot create resources.
 */
export function normalizeRecoverableState({
  storedPool = null,
  storedRemainingQty = null,
  consumedMaterials = [],
  createdQty = 1,
  currentQty = 1
} = {}) {
  const safeCreatedQty = Math.max(1, Number(createdQty) || 1);
  const safeCurrentQty = Math.max(0, Number(currentQty) || 0);
  const maxRemainingQty = Math.min(safeCreatedQty, safeCurrentQty);

  const hasStoredPool = Array.isArray(storedPool);
  const hasStoredRemaining = Number.isFinite(Number(storedRemainingQty));

  if (hasStoredPool && hasStoredRemaining) {
    return {
      remainingQty: Math.max(0, Math.min(maxRemainingQty, Number(storedRemainingQty) || 0)),
      recoverableMaterials: aggregateRefundMaterials(storedPool)
    };
  }

  const fullPool = buildRecoverablePool(consumedMaterials);
  return {
    remainingQty: maxRemainingQty,
    recoverableMaterials: scalePoolForRemainingQuantity(fullPool, maxRemainingQty, safeCreatedQty)
  };
}

/**
 * Allocate the refund for exactly one deconstructed output from a batch. The
 * allocation is front-loaded only as needed; the remaining pool is persisted,
 * so the sum of all refunds can never exceed the original recoverable pool.
 */
export function takeOneRefund(state = {}) {
  const remainingQty = Math.max(0, Number(state.remainingQty) || 0);
  const pool = aggregateRefundMaterials(state.recoverableMaterials || []);
  if (remainingQty <= 0) {
    return {
      refundMaterials: [],
      nextState: { remainingQty: 0, recoverableMaterials: pool }
    };
  }

  const refundMaterials = [];
  const nextPool = [];

  for (const material of pool) {
    const available = Math.max(0, Number(material.qty) || 0);
    const refundQty = available > 0 ? Math.ceil(available / remainingQty) : 0;
    const granted = Math.min(available, refundQty);
    if (granted > 0) refundMaterials.push({ ...material, qty: granted });

    const nextQty = available - granted;
    if (nextQty > 0) nextPool.push({ ...material, qty: nextQty });
  }

  return {
    refundMaterials,
    nextState: {
      remainingQty: Math.max(0, remainingQty - 1),
      recoverableMaterials: nextPool
    }
  };
}
