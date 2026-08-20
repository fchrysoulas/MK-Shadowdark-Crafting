import { DEFAULT_BOOK_ID, MODULE_ID } from "./constants.js";

export const RECIPE_STATE_SCHEMA_VERSION = 3;

let mutationQueue = Promise.resolve();

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function readSetting(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

function sanitizeBooks(books) {
  return books && typeof books === "object" && !Array.isArray(books)
    ? deepClone(books)
    : {};
}

function sanitizeIds(ids, books) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => id && books[id])
  ));
}

function equalJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeStoredState(raw = {}) {
  const books = sanitizeBooks(raw.books);
  const activeBookIds = sanitizeIds(raw.activeBookIds, books);

  return {
    schemaVersion: RECIPE_STATE_SCHEMA_VERSION,
    initialized: raw.initialized === true,
    revision: Math.max(0, Number(raw.revision) || 0),
    lastMutationId: String(raw.lastMutationId || ""),
    activeBookIds,
    books
  };
}

function readStoredState() {
  return normalizeStoredState(readSetting("recipeState", {}));
}

function readLegacyState() {
  const books = sanitizeBooks(readSetting("recipeBooks", {}));
  const rawLegacyIds = readSetting("activeRecipeBookIds", []);
  const legacyIds = Array.isArray(rawLegacyIds) ? rawLegacyIds : [];
  const activeFromBooks = Object.entries(books)
    .filter(([, book]) => Boolean(book?.active))
    .map(([id]) => id);
  const activeBookIds = sanitizeIds([...legacyIds, ...activeFromBooks], books);

  return {
    schemaVersion: RECIPE_STATE_SCHEMA_VERSION,
    initialized: false,
    revision: 0,
    lastMutationId: "",
    activeBookIds,
    books
  };
}

function mutationId() {
  return globalThis.foundry?.utils?.randomID?.(16)
    || globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function synchronizeBookActiveFlags(state) {
  const active = new Set(sanitizeIds(state.activeBookIds, state.books));
  state.activeBookIds = Array.from(active);
  for (const [id, book] of Object.entries(state.books)) {
    if (!book || typeof book !== "object") continue;
    book.active = active.has(id);
  }
  return state;
}

export function getRecipeState() {
  const stored = readStoredState();
  if (stored.initialized) return synchronizeBookActiveFlags(stored);
  return synchronizeBookActiveFlags(readLegacyState());
}

export async function ensureRecipeState() {
  const stored = readStoredState();
  if (stored.initialized) return synchronizeBookActiveFlags(stored);

  const fallback = synchronizeBookActiveFlags(readLegacyState());
  if (!game.user?.isGM) return fallback;

  const initial = {
    ...fallback,
    initialized: true,
    revision: 1,
    lastMutationId: mutationId()
  };
  await game.settings.set(MODULE_ID, "recipeState", initial);
  return getRecipeState();
}

async function performMutation(mutator, maxAttempts = 4) {
  if (!game.user?.isGM) throw new Error(`${MODULE_ID} | Recipe state mutations require a GM user.`);
  await ensureRecipeState();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const base = readStoredState();
    const draft = deepClone(base);
    const result = await mutator(draft);
    synchronizeBookActiveFlags(draft);

    if (equalJson(draft.books, base.books) && equalJson(draft.activeBookIds, base.activeBookIds)) {
      return { state: synchronizeBookActiveFlags(base), result };
    }

    const latestBeforeWrite = readStoredState();
    if (latestBeforeWrite.revision !== base.revision || latestBeforeWrite.lastMutationId !== base.lastMutationId) {
      continue;
    }

    const id = mutationId();
    const next = {
      ...draft,
      schemaVersion: RECIPE_STATE_SCHEMA_VERSION,
      initialized: true,
      revision: base.revision + 1,
      lastMutationId: id
    };

    await game.settings.set(MODULE_ID, "recipeState", next);
    const verified = readStoredState();
    if (verified.lastMutationId === id && verified.revision === next.revision) {
      return { state: synchronizeBookActiveFlags(verified), result };
    }
  }

  throw new Error(`${MODULE_ID} | Recipe state changed concurrently; mutation was not committed.`);
}

export function mutateRecipeState(mutator, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 4);
  const run = () => performMutation(mutator, maxAttempts);
  mutationQueue = mutationQueue.catch(() => undefined).then(run);
  return mutationQueue;
}

export async function replaceRecipeBooks(books) {
  const nextBooks = sanitizeBooks(books);
  const result = await mutateRecipeState((state) => {
    state.books = nextBooks;
    state.activeBookIds = Object.entries(nextBooks)
      .filter(([, book]) => Boolean(book?.active))
      .map(([id]) => id);
    return deepClone(state.books);
  });
  return result.state.books;
}

export async function replaceActiveRecipeBookIds(ids = []) {
  const requested = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const current = getRecipeState();
  const nextIds = requested.filter((id) => current.books[id]);
  if (equalJson(nextIds, current.activeBookIds)) return current.activeBookIds.slice();

  const result = await mutateRecipeState((state) => {
    state.activeBookIds = requested.filter((id) => state.books[id]);
    return state.activeBookIds.slice();
  });
  return result.state.activeBookIds;
}

export function getDefaultActiveRecipeBookId() {
  const state = getRecipeState();
  return state.activeBookIds.find((id) => state.books[id])
    || Object.keys(state.books)[0]
    || DEFAULT_BOOK_ID;
}
