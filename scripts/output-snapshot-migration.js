import { mutateRecipeBooks, sanitizeOutputItemData } from "./recipe-utils.js";

/**
 * Re-sanitize stored output snapshots so worlds created before stricter
 * unidentified-item privacy rules do not keep concealed data in the
 * client-readable recipeBooks setting forever.
 */
export async function sanitizeStoredOutputSnapshots() {
  let sanitizedCount = 0;

  const mutation = await mutateRecipeBooks((books) => {
    for (const [bookId, book] of Object.entries(books || {})) {
      if (!Array.isArray(book?.recipes)) continue;

      for (const recipe of book.recipes) {
        if (!recipe || !recipe.outputItemData) continue;
        const before = JSON.stringify(recipe.outputItemData);
        const sanitized = sanitizeOutputItemData(recipe.outputItemData, recipe);
        const after = JSON.stringify(sanitized);
        if (before === after) continue;

        recipe.outputItemData = sanitized;
        sanitizedCount += 1;
      }

      if (sanitizedCount > 0) books[bookId] = book;
    }
  });

  return {
    changed: mutation.changed,
    sanitizedCount
  };
}
