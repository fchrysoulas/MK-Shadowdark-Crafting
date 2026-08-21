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
globalThis.fromUuid = async () => null;

const {
  deleteRecipe,
  getActiveRecipeBookIds,
  getRecipeById,
  mutateRecipeBooks,
  sanitizeOutputItemData,
  setActiveRecipeBookIds
} = await import("../scripts/recipe-utils.js");
const { getAvailableItemTypes } = await import("../scripts/item-utils.js");
const { getCraftableRecipeById, getRecipeExecutionSignature } = await import("../scripts/craftable-recipe.js");
const { sanitizeStoredOutputSnapshots } = await import("../scripts/output-snapshot-migration.js");

test("same-client concurrent recipe book mutations are serialized without lost updates", { concurrency: false }, async () => {
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

test("book.active is authoritative over the legacy active ID mirror", { concurrency: false }, () => {
  store.recipeBooks = {
    alpha: { id: "alpha", active: true, recipes: [] },
    "legacy-book": { id: "legacy-book", active: false, recipes: [] }
  };
  store.activeRecipeBookIds = ["legacy-book"];

  assert.deepEqual(getActiveRecipeBookIds(), ["alpha"]);
});

test("setActiveRecipeBookIds synchronizes book state and the legacy compatibility mirror", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: { id: "alpha", active: true, recipes: [] },
    beta: { id: "beta", active: false, recipes: [] }
  };
  store.activeRecipeBookIds = ["alpha"];

  await setActiveRecipeBookIds(["beta"]);

  assert.equal(store.recipeBooks.alpha.active, false);
  assert.equal(store.recipeBooks.beta.active, true);
  assert.deepEqual(store.activeRecipeBookIds, ["beta"]);
});

test("book-aware recipe lookup resolves the requested book when IDs collide", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: {
      id: "alpha",
      active: true,
      recipes: [{ id: "shared-id", bookId: "alpha", outputName: "Alpha Blade", outputType: "Weapon" }]
    },
    beta: {
      id: "beta",
      active: true,
      recipes: [{ id: "shared-id", bookId: "beta", outputName: "Beta Blade", outputType: "Weapon" }]
    }
  };

  const recipe = await getRecipeById("shared-id", { bookId: "beta" });
  assert.equal(recipe.outputName, "Beta Blade");
  assert.equal(recipe.bookId, "beta");
});

test("book-scoped deletion leaves a same-ID recipe in another book untouched", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: {
      id: "alpha",
      active: true,
      recipes: [{ id: "shared-id", bookId: "alpha", outputName: "Alpha Blade", outputType: "Weapon" }]
    },
    beta: {
      id: "beta",
      active: true,
      recipes: [{ id: "shared-id", bookId: "beta", outputName: "Beta Blade", outputType: "Weapon" }]
    }
  };

  const deleted = await deleteRecipe("shared-id", { bookId: "alpha", notify: false });

  assert.equal(deleted, true);
  assert.equal(store.recipeBooks.alpha.recipes.length, 0);
  assert.equal(store.recipeBooks.beta.recipes.length, 1);
  assert.equal(store.recipeBooks.beta.recipes[0].outputName, "Beta Blade");
});

test("runtime craft lookup rejects recipes from inactive books", { concurrency: false }, async () => {
  store.recipeBooks = {
    active: {
      id: "active",
      active: true,
      recipes: [{ id: "visible", bookId: "active", outputName: "Visible", outputType: "Basic" }]
    },
    hidden: {
      id: "hidden",
      active: false,
      recipes: [{ id: "secret", bookId: "hidden", outputName: "Secret", outputType: "Basic" }]
    }
  };
  store.activeRecipeBookIds = ["active"];

  assert.equal(await getCraftableRecipeById("secret", { bookId: "hidden" }), null);
  assert.equal((await getCraftableRecipeById("visible", { bookId: "active" }))?.outputName, "Visible");
});

test("runtime craft lookup rejects disabled recipes even in active books", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: {
      id: "alpha",
      active: true,
      recipes: [{ id: "disabled", bookId: "alpha", enabled: false, outputName: "Disabled", outputType: "Basic" }]
    }
  };
  store.activeRecipeBookIds = ["alpha"];

  assert.equal(await getCraftableRecipeById("disabled", { bookId: "alpha" }), null);
});

test("unscoped runtime lookup cannot let an inactive same-ID recipe win", { concurrency: false }, async () => {
  store.recipeBooks = {
    hidden: {
      id: "hidden",
      active: false,
      recipes: [{ id: "shared", bookId: "hidden", outputName: "Hidden Version", outputType: "Basic" }]
    },
    active: {
      id: "active",
      active: true,
      recipes: [{ id: "shared", bookId: "active", outputName: "Active Version", outputType: "Basic" }]
    }
  };
  store.activeRecipeBookIds = ["active"];

  const recipe = await getCraftableRecipeById("shared");
  assert.equal(recipe?.outputName, "Active Version");
  assert.equal(recipe?.bookId, "active");
});

test("execution signature changes for mechanical recipe edits but not presentation-only edits", { concurrency: false }, () => {
  const base = {
    id: "recipe",
    bookId: "alpha",
    enabled: true,
    outputName: "Blade",
    outputType: "Weapon",
    outputQty: 1,
    dc: 12,
    abilities: ["str"],
    materialGroups: [{ alternatives: [{ name: "Iron", qty: 2, type: "Basic" }] }],
    goldCost: 5,
    notes: "old note",
    time: "1 hour"
  };

  const signature = getRecipeExecutionSignature(base);
  assert.notEqual(getRecipeExecutionSignature({ ...base, dc: 15 }), signature);
  assert.notEqual(getRecipeExecutionSignature({ ...base, goldCost: 7 }), signature);
  assert.notEqual(getRecipeExecutionSignature({ ...base, abilities: ["dex"] }), signature);
  assert.notEqual(getRecipeExecutionSignature({ ...base, outputQty: 2 }), signature);
  assert.notEqual(getRecipeExecutionSignature({
    ...base,
    materialGroups: [{ alternatives: [{ name: "Iron", qty: 3, type: "Basic" }] }]
  }), signature);
  assert.equal(getRecipeExecutionSignature({ ...base, notes: "new note", time: "2 hours" }), signature);
});

test("runtime Shadowdark item types do not reintroduce legacy NPC Spell", { concurrency: false }, () => {
  globalThis.game.system.documentTypes.Item = ["Basic", "Weapon", "Armor", "NPC Attack", "Spell"];
  const types = getAvailableItemTypes();

  assert.ok(types.includes("NPC Attack"));
  assert.ok(types.includes("Spell"));
  assert.equal(types.includes("NPC Spell"), false);
});

test("output snapshots retain item mechanics but strip unrelated metadata and flags", { concurrency: false }, () => {
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

test("unidentified Shadowdark snapshots do not reveal concealed identity or effects", { concurrency: false }, () => {
  const snapshot = sanitizeOutputItemData({
    name: "Mysterious Sword",
    type: "Weapon",
    img: "icons/mystery.webp",
    system: {
      quantity: 1,
      description: "A dull black sword with no visible markings.",
      identification: {
        identified: false,
        name: "Blade of the Secret King",
        description: "The hidden true powers and curse."
      }
    },
    effects: [
      {
        name: "Hidden Fire Power",
        changes: [{ key: "system.damage", mode: 2, value: "1d6" }]
      }
    ]
  }, { outputName: "Fallback", outputType: "Weapon" });

  assert.equal(snapshot.name, "Mysterious Sword");
  assert.equal(snapshot.system.description, "A dull black sword with no visible markings.");
  assert.equal(snapshot.system.identification.identified, false);
  assert.equal(snapshot.system.identification.name, undefined);
  assert.equal(snapshot.system.identification.description, undefined);
  assert.equal(snapshot.effects, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /Secret King|hidden true powers|Hidden Fire Power/);
});

test("stored unidentified snapshots are sanitized out of the world setting", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: {
      id: "alpha",
      active: false,
      recipes: [{
        id: "secret-recipe",
        bookId: "alpha",
        outputName: "Mysterious Sword",
        outputType: "Weapon",
        outputItemData: {
          name: "Mysterious Sword",
          type: "Weapon",
          system: {
            description: "Visible text",
            identification: {
              identified: false,
              name: "Secret True Name",
              description: "Secret true description"
            }
          },
          effects: [{ name: "Secret Effect", changes: [] }]
        }
      }]
    }
  };

  const result = await sanitizeStoredOutputSnapshots();
  const stored = store.recipeBooks.alpha.recipes[0].outputItemData;

  assert.equal(result.changed, true);
  assert.equal(result.sanitizedCount, 1);
  assert.equal(stored.system.identification.identified, false);
  assert.equal(stored.system.identification.name, undefined);
  assert.equal(stored.system.identification.description, undefined);
  assert.equal(stored.effects, undefined);
  assert.doesNotMatch(JSON.stringify(store.recipeBooks), /Secret True Name|Secret true description|Secret Effect/);
});
