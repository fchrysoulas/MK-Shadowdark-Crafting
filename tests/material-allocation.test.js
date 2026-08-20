import test from "node:test";
import assert from "node:assert/strict";

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

globalThis.game = {
  user: { isGM: true },
  i18n: {
    lang: "en",
    localize: (key) => key,
    format: (key) => key
  }
};

globalThis.foundry = {
  utils: { getProperty }
};

function makeItem(id, name, qty, type = "Basic") {
  return {
    id,
    name,
    type,
    uuid: `Actor.test.Item.${id}`,
    system: { quantity: qty },
    _stats: {},
    getFlag: () => null
  };
}

function makeActor(items) {
  return {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Crafter",
    type: "character",
    isOwner: true,
    items
  };
}

const { planMaterialGroups } = await import("../scripts/material-allocation.js");

test("one inventory quantity cannot satisfy two requirement groups", () => {
  const actor = makeActor([makeItem("iron", "Iron", 2)]);
  const groups = [
    { alternatives: [{ name: "Iron", qty: 2 }] },
    { alternatives: [{ name: "Iron", qty: 2 }] }
  ];

  const plan = planMaterialGroups([actor], groups);
  assert.equal(plan.ok, false);
});

test("substitute allocation backtracks to find a globally valid combination", () => {
  const actor = makeActor([
    makeItem("iron", "Iron", 2),
    makeItem("wood", "Wood", 4)
  ]);
  const groups = [
    { alternatives: [{ name: "Iron", qty: 2 }, { name: "Wood", qty: 4 }] },
    { alternatives: [{ name: "Iron", qty: 2 }] }
  ];

  const plan = planMaterialGroups([actor], groups);
  assert.equal(plan.ok, true);
  assert.equal(plan.selections[0].material.name, "Wood");
  assert.equal(plan.selections[1].material.name, "Iron");
});

test("duplicate stacks on one actor are aggregated and allocated", () => {
  const actor = makeActor([
    makeItem("wood-a", "Wood", 3),
    makeItem("wood-b", "Wood", 3)
  ]);
  const groups = [{ alternatives: [{ name: "Wood", qty: 5 }] }];

  const plan = planMaterialGroups([actor], groups);
  assert.equal(plan.ok, true);
  assert.equal(plan.selections[0].allocations.length, 2);
  assert.equal(plan.selections[0].allocations.reduce((sum, entry) => sum + entry.qty, 0), 5);
});
