import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const settings = {
  checkTools: true,
  checkStations: true,
  useGoldCost: false
};

globalThis.game = {
  user: { isGM: true },
  settings: {
    get: (_moduleId, key) => settings[key]
  },
  i18n: {
    lang: "en",
    localize: (key) => key,
    format: (key, data = {}) => `${key}:${data.name ?? ""}`
  }
};

globalThis.foundry = {
  utils: {
    getProperty: (object, propertyPath) => String(propertyPath || "").split(".").reduce((value, key) => value?.[key], object)
  }
};

globalThis.CONFIG = {};
globalThis.canvas = { tokens: { placeables: [] }, scene: { tokens: [] } };

function makeActor(itemNames = []) {
  return {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Crafter",
    type: "character",
    isOwner: true,
    items: itemNames.map((name, index) => ({ id: `item-${index}`, name, system: { quantity: 1 } }))
  };
}

const { checkRecipeRequirements } = await import("../scripts/recipe-utils.js");

const recipe = {
  materialGroups: [],
  goldCost: 0,
  toolRequired: "Smith Tools",
  stationRequired: "Forge"
};

test("required tool removal is detected by the final requirement checker", () => {
  const actor = makeActor(["Smith Tools", "Forge"]);
  const before = checkRecipeRequirements(actor, recipe, { resourceActors: [actor] });
  assert.equal(before.toolOk, true);

  actor.items = actor.items.filter((item) => item.name !== "Smith Tools");
  const after = checkRecipeRequirements(actor, recipe, { resourceActors: [actor] });
  assert.equal(after.toolOk, false);
  assert.ok(after.missing.some((entry) => entry.includes("MKSDC.Requirements.ToolMissing")));
});

test("required station removal is detected by the final requirement checker", () => {
  const actor = makeActor(["Smith Tools", "Forge"]);
  const before = checkRecipeRequirements(actor, recipe, { resourceActors: [actor] });
  assert.equal(before.stationOk, true);

  actor.items = actor.items.filter((item) => item.name !== "Forge");
  const after = checkRecipeRequirements(actor, recipe, { resourceActors: [actor] });
  assert.equal(after.stationOk, false);
  assert.ok(after.missing.some((entry) => entry.includes("MKSDC.Requirements.StationMissing")));
});

test("crafting engine revalidates tools and stations after locking and before mutation", async () => {
  const source = await readFile(path.join(process.cwd(), "scripts/crafting-engine.js"), "utf8");
  const beginIndex = source.indexOf("await transaction.begin()");
  const finalCheckIndex = source.indexOf("const lockedRequirements = checkRecipeRequirements", beginIndex);
  const gateIndex = source.indexOf("!lockedRequirements.toolOk || !lockedRequirements.stationOk", finalCheckIndex);
  const mutationIndex = source.indexOf("transaction.consumeMaterialAllocations", beginIndex);

  assert.ok(beginIndex >= 0, "economy lock acquisition should exist");
  assert.ok(finalCheckIndex > beginIndex, "final requirement check must occur after acquiring the lock");
  assert.ok(gateIndex > finalCheckIndex, "tool/station result must gate the operation");
  assert.ok(mutationIndex > gateIndex, "no material mutation may occur before the final tool/station gate");
});
