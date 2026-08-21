import test from "node:test";
import assert from "node:assert/strict";

const store = {
  recipeBooks: {},
  activeRecipeBookIds: [],
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
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = mergeObject(result[key] || {}, value);
    else result[key] = deepClone(value);
  }
  return result;
}

globalThis.foundry = {
  utils: { deepClone, getProperty, setProperty, mergeObject, randomID: () => "test-id" }
};
globalThis.game = {
  user: { isGM: true },
  system: { id: "shadowdark", version: "4.0.6", documentTypes: { Item: ["Basic"] } },
  i18n: { lang: "en", localize: (key) => key, format: (key) => key },
  settings: {
    get: (_moduleId, key) => store[key],
    set: async (_moduleId, key, value) => {
      store[key] = deepClone(value);
      return value;
    }
  }
};
globalThis.CONFIG = {};
globalThis.canvas = { tokens: { placeables: [] }, scene: { tokens: [] } };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.fromUuid = async () => null;

const { ensureDefaultRecipeBook, getActiveRecipeBookIds } = await import("../scripts/recipe-utils.js");

test("explicit modern all-inactive state remains empty despite stale legacy mirror", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: { id: "alpha", active: false, recipes: [] },
    beta: { id: "beta", active: false, recipes: [] }
  };
  store.activeRecipeBookIds = ["alpha"];

  assert.deepEqual(getActiveRecipeBookIds(), []);
  await ensureDefaultRecipeBook();

  assert.deepEqual(getActiveRecipeBookIds(), []);
  assert.equal(store.recipeBooks.alpha.active, false);
  assert.equal(store.recipeBooks.beta.active, false);
  assert.equal(store.recipeBooks["world-recipes"].active, false);
  assert.deepEqual(store.activeRecipeBookIds, []);
});

test("fresh world creates one active default book", { concurrency: false }, async () => {
  store.recipeBooks = {};
  store.activeRecipeBookIds = ["world-recipes"];

  await ensureDefaultRecipeBook();

  assert.equal(store.recipeBooks["world-recipes"].active, true);
  assert.deepEqual(getActiveRecipeBookIds(), ["world-recipes"]);
});

test("legacy books without active fields migrate from the compatibility mirror", { concurrency: false }, async () => {
  store.recipeBooks = {
    alpha: { id: "alpha", recipes: [] },
    beta: { id: "beta", recipes: [] }
  };
  store.activeRecipeBookIds = ["beta"];

  assert.deepEqual(getActiveRecipeBookIds(), ["beta"]);
  await ensureDefaultRecipeBook();

  assert.equal(store.recipeBooks.alpha.active, false);
  assert.equal(store.recipeBooks.beta.active, true);
  assert.equal(store.recipeBooks["world-recipes"].active, false);
  assert.deepEqual(getActiveRecipeBookIds(), ["beta"]);
});

test("legacy world with no active marker receives a sensible default during migration", { concurrency: false }, async () => {
  store.recipeBooks = {
    legacy: { id: "legacy", recipes: [] }
  };
  store.activeRecipeBookIds = [];

  await ensureDefaultRecipeBook();

  assert.equal(store.recipeBooks.legacy.active, false);
  assert.equal(store.recipeBooks["world-recipes"].active, true);
  assert.deepEqual(getActiveRecipeBookIds(), ["world-recipes"]);
});
