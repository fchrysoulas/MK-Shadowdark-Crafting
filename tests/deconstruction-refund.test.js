import test from "node:test";
import assert from "node:assert/strict";

const {
  buildRecoverablePool,
  normalizeRecoverableState,
  takeOneRefund
} = await import("../scripts/deconstruction-refund.js");

function drainState(initialState) {
  let state = initialState;
  const totals = new Map();

  while (state.remainingQty > 0) {
    const result = takeOneRefund(state);
    for (const material of result.refundMaterials) {
      totals.set(material.name, (totals.get(material.name) || 0) + material.qty);
    }
    state = result.nextState;
  }

  return totals;
}

test("one Iron producing two outputs cannot refund more than one Iron", () => {
  const pool = buildRecoverablePool([{ name: "Iron", qty: 1 }]);
  const totals = drainState({ remainingQty: 2, recoverableMaterials: pool });
  assert.equal(totals.get("Iron"), 1);
});

test("three Wood producing four outputs refunds at most half the input once", () => {
  const pool = buildRecoverablePool([{ name: "Wood", qty: 3 }]);
  const totals = drainState({ remainingQty: 4, recoverableMaterials: pool });
  assert.equal(totals.get("Wood"), 2);
});

test("legacy partially depleted batches scale the refund pool down conservatively", () => {
  const state = normalizeRecoverableState({
    consumedMaterials: [{ name: "Wood", qty: 3 }],
    createdQty: 4,
    currentQty: 2
  });

  assert.equal(state.remainingQty, 2);
  assert.equal(state.recoverableMaterials[0].qty, 1);
});
