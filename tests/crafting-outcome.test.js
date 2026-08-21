import test from "node:test";
import assert from "node:assert/strict";

import { getCraftingOutcome, getOutcomeConsumeQty } from "../scripts/crafting-outcome.js";

test("natural d20 results override the modified total", () => {
  assert.equal(getCraftingOutcome({ rollTotal: 2, dc: 30, d20: 20 }), "criticalSuccess");
  assert.equal(getCraftingOutcome({ rollTotal: 40, dc: 5, d20: 1 }), "criticalFailure");
  assert.equal(getCraftingOutcome({ rollTotal: 15, dc: 15, d20: 12 }), "success");
  assert.equal(getCraftingOutcome({ rollTotal: 14, dc: 15, d20: 12 }), "failure");
});

test("material and gold costs follow every configured crafting outcome", () => {
  const costs = { material: 5, gold: 7 };
  const quantities = (outcome, policy) => Object.fromEntries(
    Object.entries(costs).map(([kind, qty]) => [kind, getOutcomeConsumeQty(qty, outcome, policy)])
  );

  assert.deepEqual(quantities("success", {}), { material: 5, gold: 7 });
  assert.deepEqual(quantities("criticalSuccess", { criticalSuccessHalfCost: true }), { material: 3, gold: 4 });
  assert.deepEqual(quantities("failure", { consumeMaterialsOnFailure: true }), { material: 3, gold: 4 });
  assert.deepEqual(quantities("criticalFailure", {
    consumeMaterialsOnFailure: true,
    criticalFailureLosesAll: true
  }), { material: 5, gold: 7 });
  assert.deepEqual(quantities("failure", { consumeMaterialsOnFailure: false }), { material: 0, gold: 0 });
});
