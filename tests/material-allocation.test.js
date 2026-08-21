import test from "node:test";
import assert from "node:assert/strict";

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

globalThis.game = {
  user: { isGM: true },
  system: { documentTypes: { Item: ["Basic"] } },
  i18n: {
    lang: "en",
    localize: (key) => key,
    format: (key) => key
  }
};

globalThis.CONFIG = {};
globalThis.foundry = {
  utils: { getProperty }
};

function makeItem(id, name, qty, type = "Basic", { sourceId = "", compendiumSource = "", actorId = "actor-1" } = {}) {
  const parent = { id: actorId, uuid: `Actor.${actorId}`, documentName: "Actor" };
  return {
    id,
    name,
    type,
    uuid: `Actor.${actorId}.Item.${id}`,
    parent,
    system: { quantity: qty },
    _stats: { compendiumSource },
    getFlag: (scope, key) => scope === "core" && key === "sourceId" ? sourceId : null
  };
}

function makeActor(items, id = "actor-1", name = "Crafter") {
  return {
    id,
    uuid: `Actor.${id}`,
    name,
    type: "character",
    isOwner: true,
    items
  };
}

const { planMaterialGroups } = await import("../scripts/material-allocation.js");
const { getMatchingOwnedMaterialItems, getStableMaterialUuid, materialMatchesItemIdentity } = await import("../scripts/material-identity.js");

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

test("one material requirement can reserve quantities across selected resource actors", () => {
  const crafter = makeActor([makeItem("iron-a", "Iron", 2)], "actor-1", "Crafter");
  const helper = makeActor([
    makeItem("iron-b", "Iron", 3, "Basic", { actorId: "actor-2" })
  ], "actor-2", "Helper");
  const groups = [{ alternatives: [{ name: "Iron", qty: 5 }] }];

  const plan = planMaterialGroups([crafter, helper], groups);

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.selections[0].allocations.map(({ actorId, itemId, qty }) => ({ actorId, itemId, qty })), [
    { actorId: "Actor.actor-1", itemId: "iron-a", qty: 2 },
    { actorId: "Actor.actor-2", itemId: "iron-b", qty: 3 }
  ]);
});

test("actor-owned material drops do not persist their embedded instance UUID", () => {
  const item = makeItem("iron", "Iron", 2);
  assert.equal(getStableMaterialUuid(item, item.uuid), "");
});

test("actor-owned material drops prefer a stable source UUID when available", () => {
  const item = makeItem("iron", "Iron", 2, "Basic", { sourceId: "Compendium.shadowdark.items.Item.iron" });
  assert.equal(getStableMaterialUuid(item, item.uuid), "Compendium.shadowdark.items.Item.iron");
});

test("source-specific materials match copies by stable source metadata", () => {
  const sourceUuid = "Compendium.shadowdark.items.Item.iron";
  const copied = makeItem("iron-copy", "Iron", 2, "Basic", { sourceId: sourceUuid });
  const other = makeItem("other-iron", "Iron", 9, "Basic", { sourceId: "Compendium.other.Item.iron" });
  const actor = makeActor([copied, other]);
  const material = { name: "Iron", type: "Basic", uuid: sourceUuid, qty: 2 };

  assert.equal(materialMatchesItemIdentity(copied, material), true);
  assert.equal(materialMatchesItemIdentity(other, material), false);
  assert.deepEqual(getMatchingOwnedMaterialItems(actor, material), [copied]);

  const plan = planMaterialGroups([actor], [{ alternatives: [material] }]);
  assert.equal(plan.ok, true);
  assert.equal(plan.selections[0].allocations.length, 1);
  assert.equal(plan.selections[0].allocations[0].itemId, "iron-copy");
});

test("UUID-specific recovery matching never falls back to an unrelated same-name stack", () => {
  const actor = makeActor([
    makeItem("wrong", "Iron", 20, "Basic", { sourceId: "Compendium.other.Item.iron" })
  ]);
  const material = {
    name: "Iron",
    type: "Basic",
    uuid: "Compendium.shadowdark.items.Item.iron",
    qty: 1
  };

  assert.deepEqual(getMatchingOwnedMaterialItems(actor, material), []);
});
