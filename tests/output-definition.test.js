import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOutputSourceMode,
  OUTPUT_SOURCE_MODE,
  resolveRecipeOutputDefinition
} from "../scripts/output-definition.js";

const clone = (value) => structuredClone(value);

test("snapshot mode is the default and ignores edits to the live source", async () => {
  let resolveCalls = 0;
  const recipe = {
    outputUuid: "Actor.a.Item.output",
    outputItemData: { name: "Saved Blade", system: { damage: "1d6" } }
  };

  const result = await resolveRecipeOutputDefinition(recipe, {
    clone,
    resolveUuid: async () => {
      resolveCalls += 1;
      return { toObject: () => ({ name: "Edited Blade", system: { damage: "2d10" } }) };
    }
  });

  assert.equal(normalizeOutputSourceMode(undefined), OUTPUT_SOURCE_MODE.SNAPSHOT);
  assert.equal(result.source, "snapshot");
  assert.equal(result.data.name, "Saved Blade");
  assert.equal(result.data.system.damage, "1d6");
  assert.equal(resolveCalls, 0);
});

test("snapshot output is unchanged when its actor-owned provenance UUID is deleted", async () => {
  const recipe = {
    outputSourceMode: "snapshot",
    outputUuid: "Actor.deleted.Item.output",
    outputItemData: { name: "Portable Blade", system: { damage: "1d8" } }
  };

  const result = await resolveRecipeOutputDefinition(recipe, {
    clone,
    resolveUuid: async () => null
  });

  assert.equal(result.source, "snapshot");
  assert.equal(result.data.name, "Portable Blade");
  assert.equal(result.data.system.damage, "1d8");
});

test("legacy UUID-only recipes still resolve their source as a compatibility fallback", async () => {
  const recipe = {
    outputUuid: "Compendium.shadowdark.items.Item.legacy",
    outputItemData: null
  };

  const result = await resolveRecipeOutputDefinition(recipe, {
    clone,
    resolveUuid: async () => ({ toObject: () => ({ name: "Legacy Blade", system: { damage: "1d6" } }) })
  });

  assert.equal(result.source, "legacy-uuid");
  assert.equal(result.data.name, "Legacy Blade");
});

test("linked mode intentionally follows the current source document", async () => {
  const recipe = {
    outputSourceMode: "linked",
    outputUuid: "Compendium.shadowdark.items.Item.secret",
    outputItemData: { name: "Public Snapshot", system: { identification: { identified: false } } }
  };

  const result = await resolveRecipeOutputDefinition(recipe, {
    clone,
    resolveUuid: async () => ({
      toObject: () => ({
        name: "Mysterious Sword",
        system: {
          identification: {
            identified: false,
            name: "Blade of the Secret King"
          }
        },
        effects: [{ name: "Hidden Power" }]
      })
    })
  });

  assert.equal(result.source, "linked");
  assert.equal(result.data.system.identification.name, "Blade of the Secret King");
  assert.equal(result.data.effects[0].name, "Hidden Power");
});

test("linked mode falls back to the saved snapshot when the source is unavailable", async () => {
  const recipe = {
    outputSourceMode: "linked",
    outputUuid: "Actor.missing.Item.secret",
    outputItemData: { name: "Safe Fallback", system: { quantity: 1 } }
  };

  const result = await resolveRecipeOutputDefinition(recipe, {
    clone,
    resolveUuid: async () => null
  });

  assert.equal(result.source, "snapshot-fallback");
  assert.equal(result.data.name, "Safe Fallback");
});
