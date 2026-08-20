import {
  getActiveRecipeBookIds,
  getRecipeBooks,
  parseRecipeReference,
  sanitizeRecipeData
} from "./recipe-utils.js";

function canonicalMaterial(material = {}) {
  return {
    name: String(material.name || "").trim(),
    qty: Math.max(0, Number(material.qty) || 0),
    uuid: String(material.uuid || "").trim(),
    type: String(material.type || "").trim()
  };
}

function canonicalMaterialGroups(groups = []) {
  return (groups || []).map((group) => ({
    alternatives: (group?.alternatives || []).map(canonicalMaterial)
  }));
}

function getRuntimeActiveBookIds(books = {}) {
  const entries = Object.entries(books);
  const hasExplicitActiveState = entries.some(([, book]) => Object.hasOwn(book || {}, "active"));
  if (hasExplicitActiveState) {
    return entries.filter(([, book]) => book?.active === true).map(([id]) => id);
  }

  // Legacy books which genuinely predate book.active may still use the old
  // active-ID setting until the normal migration path writes explicit flags.
  return getActiveRecipeBookIds();
}

/**
 * Return only recipes which are eligible for normal runtime crafting.
 * Editor/deconstruction lookups deliberately remain broader in recipe-utils.
 */
export async function getCraftableRecipeById(recipeId, options = {}) {
  const { id, bookId } = parseRecipeReference(recipeId, options);
  if (!id) return null;

  const books = getRecipeBooks();
  const activeIds = getRuntimeActiveBookIds(books);
  const activeSet = new Set(activeIds);

  if (bookId) {
    if (!activeSet.has(bookId)) return null;
    const book = books[bookId];
    if (!book) return null;
    const raw = (book.recipes || []).find((entry) => String(entry.id) === id);
    if (!raw) return null;
    const recipe = sanitizeRecipeData(raw, { bookId, id: raw.id });
    return recipe.enabled ? recipe : null;
  }

  // Search active books only, in active-book order. This prevents a same-ID
  // recipe in an inactive book from winning an unscoped runtime lookup.
  for (const activeBookId of activeIds) {
    const book = books[activeBookId];
    if (!book) continue;
    const raw = (book.recipes || []).find((entry) => String(entry.id) === id);
    if (!raw) continue;
    const recipe = sanitizeRecipeData(raw, { bookId: activeBookId, id: raw.id });
    if (recipe.enabled) return recipe;
  }

  return null;
}

/**
 * Stable comparison of the recipe fields which can change the economic or
 * mechanical result of a crafting attempt. Presentation-only fields such as
 * notes/category/time are intentionally excluded.
 */
export function getRecipeExecutionSignature(recipe = {}) {
  return JSON.stringify({
    id: String(recipe.id || ""),
    bookId: String(recipe.bookId || ""),
    enabled: recipe.enabled !== false,
    outputName: String(recipe.outputName || ""),
    outputUuid: String(recipe.outputUuid || ""),
    outputType: String(recipe.outputType || ""),
    outputQty: Math.max(1, Number(recipe.outputQty) || 1),
    outputItemData: recipe.outputItemData ?? null,
    dc: Math.max(1, Number(recipe.dc) || 1),
    abilities: Array.isArray(recipe.abilities) ? recipe.abilities.map((ability) => String(ability || "")) : [],
    toolRequired: String(recipe.toolRequired || ""),
    stationRequired: String(recipe.stationRequired || ""),
    materialGroups: canonicalMaterialGroups(recipe.materialGroups),
    goldCost: Math.max(0, Number(recipe.goldCost) || 0)
  });
}
