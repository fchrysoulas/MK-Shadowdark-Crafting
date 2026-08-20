import test from "node:test";
import assert from "node:assert/strict";

const settingsStore = new Map();
let writeCount = 0;

function resetSettings() {
  settingsStore.clear();
  writeCount = 0;
  settingsStore.set("mk-shadowdark-crafting.recipeState", {
    schemaVersion: 3,
    initialized: false,
    revision: 0,
    lastMutationId: "",
    activeBookIds: [],
    books: {}
  });
  settingsStore.set("mk-shadowdark-crafting.recipeBooks", {});
  settingsStore.set("mk-shadowdark-crafting.activeRecipeBookIds", ["world-recipes"]);
}

globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    randomID: (() => {
      let value = 0;
      return () => `id-${++value}`;
    })()
  }
};

globalThis.game = {
  user: { isGM: true },
  settings: {
    get(moduleId, key) {
      return structuredClone(settingsStore.get(`${moduleId}.${key}`));
    },
    async set(moduleId, key, value) {
      writeCount += 1;
      settingsStore.set(`${moduleId}.${key}`, structuredClone(value));
      return value;
    }
  }
};

const {
  ensureRecipeState,
  getRecipeState,
  mutateRecipeState,
  replaceActiveRecipeBookIds
} = await import("../scripts/recipe-state.js");

test("legacy recipe settings migrate into one initialized recipe state", async () => {
  resetSettings();
  settingsStore.set("mk-shadowdark-crafting.recipeBooks", {
    "world-recipes": { id: "world-recipes", active: true, recipes: [] },
    alchemy: { id: "alchemy", active: false, recipes: [] }
  });
  settingsStore.set("mk-shadowdark-crafting.activeRecipeBookIds", ["alchemy"]);

  const before = getRecipeState();
  assert.deepEqual(new Set(before.activeBookIds), new Set(["world-recipes", "alchemy"]));
  assert.equal(before.initialized, false);

  const migrated = await ensureRecipeState();
  assert.equal(migrated.initialized, true);
  assert.equal(writeCount, 1);
  assert.deepEqual(new Set(migrated.activeBookIds), new Set(["world-recipes", "alchemy"]));

  settingsStore.set("mk-shadowdark-crafting.recipeBooks", {});
  const afterLegacyChanged = getRecipeState();
  assert.ok(afterLegacyChanged.books["world-recipes"]);
  assert.ok(afterLegacyChanged.books.alchemy);
});

test("a logical recipe mutation produces one recipeState write", async () => {
  resetSettings();
  await ensureRecipeState();
  writeCount = 0;

  const result = await mutateRecipeState((state) => {
    state.books.alpha = { id: "alpha", active: true, recipes: [] };
    state.activeBookIds = ["alpha"];
    return "saved";
  });

  assert.equal(result.result, "saved");
  assert.equal(writeCount, 1);
  assert.deepEqual(result.state.activeBookIds, ["alpha"]);
  assert.equal(result.state.books.alpha.active, true);
});

test("setting already-active recipe books is a no-op", async () => {
  resetSettings();
  await ensureRecipeState();
  await mutateRecipeState((state) => {
    state.books.alpha = { id: "alpha", active: true, recipes: [] };
    state.activeBookIds = ["alpha"];
  });

  writeCount = 0;
  const ids = await replaceActiveRecipeBookIds(["alpha"]);
  assert.deepEqual(ids, ["alpha"]);
  assert.equal(writeCount, 0);
});

test("active flags are synchronized with activeBookIds", async () => {
  resetSettings();
  await ensureRecipeState();
  await mutateRecipeState((state) => {
    state.books.alpha = { id: "alpha", active: false, recipes: [] };
    state.books.beta = { id: "beta", active: true, recipes: [] };
    state.activeBookIds = ["alpha"];
  });

  const state = getRecipeState();
  assert.equal(state.books.alpha.active, true);
  assert.equal(state.books.beta.active, false);
  assert.deepEqual(state.activeBookIds, ["alpha"]);
});
