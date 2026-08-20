import test from "node:test";
import assert from "node:assert/strict";

const store = {
  recipeBooks: {},
  activeRecipeBookIds: ["legacy-book"],
  debug: false
};

function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = String(path || "").split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
  return true;
}

function mergeObject(original, other) {
  const result = deepClone(original || {});
  for (const [key, value] of Object.entries(other || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeObject(result[key] || {}, value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

globalThis.foundry = {
  utils: {
    deepClone,
    getProperty,
    setProperty,
    mergeObject,
    randomID: () => "test-id"
  }
};

globalThis.game = {
  user: { isGM: true },
  system: {
    id: "shadowdark",
    version: "4.0.6",
    documentTypes: { Item: ["Basic", "Weapon", "Armor", "Effect"] }
  },
  i18n: {
    lang: "en",
    localize: (key) => key,
    format: (key) => key
  },
  settings: {
    get: (_moduleId, key) => store[key],
    set: async (_moduleId, key, value) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      store[key] = deepClone(value);
      return value;
    }
  }
};

globalThis.CONFIG = {};
globalThis.canvas = { tokens: { placeables: [] }, scene: { tokens: [] } };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

const {
  getActiveRecipeBookIds,
  mutateRecipeBooks,
  sanitizeOutputItemData
} = await import("../scripts/recipe-utils.js");

test("same-client concurrent recipe book mutations are serialized without lost updates", async () => {
  store.recipeBooks = {};

  await Promise.all([
    mutateRecipeBooks(async (books) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      books.alpha = { id: "alpha", active: true, recipes: [] };
    }),
    mutateRecipeBooks((books) => {
      books.beta = { id: "beta", active: false, recipes: [] };
    })
  ]);

  assert.ok(store.recipeBooks.alpha);
  assert.ok(store.recipeBooks.beta);
});

test("book.active is authoritative over the legacy active ID mirror", () => {
  store.recipeBooks = {
    alpha: { id: "alpha", active: true, recipes: [] },
    "legacy-book": { id: "legacy-book", active: false, recipes: [] }
  };
  store.activeRecipeBookIds = ["legacy-book"];

  assert.deepEqual(getActiveRecipeBookIds(), ["alpha"]);
});

test("output snapshots retain item mechanics but strip unrelated metadata and flags", () => {
  const snapshot = sanitizeOutputItemData({
    _id: "secret-id",
    name: "Test Blade",
    type: "Weapon",
    img: "icons/test.webp",
    folder: "secret-folder",
    ownership: { default: 0 },
    flags: {
      thirdParty: { hiddenData: "secret" },
      core: { sourceId: "Compendium.secret" }
    },
    system: {
      quantity: 1,
      damage: { dice: "1d6" },
      description: "Visible item description"
    },
    effects: [
      {
        _id: "effect-id",
        name: "Sharp",
        origin: "Compendium.secret.Item.foo",
        flags: { thirdParty: { secret: true } },
        changes: [{ key: "system.test", mode: 2, value: "1" }]
      }
    ]
  }, { outputName: "Fallback", outputType: "Basic" });

  assert.equal(snapshot.name, "Test Blade");
  assert.equal(snapshot.type, "Weapon");
  assert.equal(snapshot.system.damage.dice, "1d6");
  assert.equal(snapshot.folder, undefined);
  assert.equal(snapshot.ownership, undefined);
  assert.equal(snapshot.flags, undefined);
  assert.equal(snapshot.effects[0]._id, undefined);
  assert.equal(snapshot.effects[0].origin, undefined);
  assert.equal(snapshot.effects[0].flags, undefined);
  assert.deepEqual(snapshot.effects[0].changes, [{ key: "system.test", mode: 2, value: "1" }]);
});
