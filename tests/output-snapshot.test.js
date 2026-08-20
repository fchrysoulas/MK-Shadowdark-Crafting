import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    mergeObject(base, source) {
      return { ...structuredClone(base), ...structuredClone(source) };
    },
    randomID: () => "test-id"
  }
};

globalThis.CONFIG = {};
globalThis.game = {
  system: {
    id: "shadowdark",
    documentTypes: {
      Item: ["Basic", "Weapon", "Armor", "Spell"]
    }
  },
  settings: {
    get() {
      return false;
    }
  }
};

const { sanitizeOutputItemData } = await import("../scripts/recipe-utils.js");

test("output snapshots keep reconstruction data but remove unrelated metadata", () => {
  const snapshot = sanitizeOutputItemData({
    _id: "secret-id",
    name: "Iron Blade",
    type: "Weapon",
    img: "blade.webp",
    folder: "gm-folder",
    ownership: { default: 0 },
    sort: 500,
    system: {
      quantity: 1,
      damage: { formula: "1d8" }
    },
    flags: {
      shadowdark: { special: true },
      "third-party-module": { hiddenMechanic: "do-not-copy" },
      "mk-shadowdark-crafting": { recipe: { secret: true } }
    },
    effects: [
      {
        _id: "effect-id",
        name: "Sharp",
        img: "sharp.webp",
        disabled: false,
        transfer: true,
        changes: [{ key: "system.test", mode: 2, value: "1" }],
        flags: { "third-party-module": { secret: true } },
        origin: "Item.secret"
      }
    ]
  }, { outputName: "Iron Blade", outputType: "Weapon" });

  assert.equal(snapshot.name, "Iron Blade");
  assert.equal(snapshot.type, "Weapon");
  assert.deepEqual(snapshot.system.damage, { formula: "1d8" });
  assert.deepEqual(snapshot.flags, { shadowdark: { special: true } });
  assert.equal(snapshot.folder, undefined);
  assert.equal(snapshot.ownership, undefined);
  assert.equal(snapshot.sort, undefined);
  assert.equal(snapshot._id, undefined);

  assert.equal(snapshot.effects.length, 1);
  assert.equal(snapshot.effects[0].name, "Sharp");
  assert.equal(snapshot.effects[0].flags, undefined);
  assert.equal(snapshot.effects[0].origin, undefined);
  assert.equal(snapshot.effects[0]._id, undefined);
});
