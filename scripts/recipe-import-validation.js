export class RecipeImportValidationError extends Error {
  constructor(errors = []) {
    const details = Array.isArray(errors) ? errors.filter(Boolean) : [];
    super(details.length
      ? `Invalid recipe numeric values: ${details.join("; ")}`
      : "Invalid recipe numeric values.");
    this.name = "RecipeImportValidationError";
    this.errors = details;
  }
}

function hasOwn(object, key) {
  return Boolean(object && typeof object === "object" && Object.hasOwn(object, key));
}

function parseSafeInteger(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    value = Number(trimmed);
  }

  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null;
  return value;
}

function validateIntegerField(errors, object, key, label, { min = 0 } = {}) {
  if (!hasOwn(object, key)) return;
  const parsed = parseSafeInteger(object[key]);
  if (parsed === null || parsed < min) {
    const requirement = min > 0 ? `a safe integer >= ${min}` : "a safe integer >= 0";
    errors.push(`${label} must be ${requirement}`);
  }
}

function validateMaterial(errors, material, path) {
  if (!material || typeof material !== "object") return;
  validateIntegerField(errors, material, "qty", `${path}.qty`, { min: 1 });
}

function validateMaterialGroup(errors, group, path) {
  if (!group || typeof group !== "object") return;
  const alternatives = Array.isArray(group.alternatives)
    ? group.alternatives
    : Array.isArray(group.items)
      ? group.items
      : [];
  alternatives.forEach((material, index) => validateMaterial(errors, material, `${path}.alternatives[${index}]`));
}

function validateRecipe(errors, recipe, path) {
  if (!recipe || typeof recipe !== "object") return;

  validateIntegerField(errors, recipe, "outputQty", `${path}.outputQty`, { min: 1 });
  validateIntegerField(errors, recipe, "dc", `${path}.dc`, { min: 1 });
  validateIntegerField(errors, recipe, "goldCost", `${path}.goldCost`, { min: 0 });

  if (Array.isArray(recipe.materialGroups)) {
    recipe.materialGroups.forEach((group, index) => validateMaterialGroup(errors, group, `${path}.materialGroups[${index}]`));
  }

  if (Array.isArray(recipe.materials)) {
    recipe.materials.forEach((material, index) => validateMaterial(errors, material, `${path}.materials[${index}]`));
  }

  if (Array.isArray(recipe.deconstructMaterials)) {
    recipe.deconstructMaterials.forEach((material, index) => validateMaterial(errors, material, `${path}.deconstructMaterials[${index}]`));
  }

  if (Array.isArray(recipe.deconstructMaterialGroups)) {
    recipe.deconstructMaterialGroups.forEach((group, index) => validateMaterialGroup(errors, group, `${path}.deconstructMaterialGroups[${index}]`));
  }
}

/**
 * Validate external Recipe Book numeric fields before sanitization.
 *
 * Numeric strings are accepted for compatibility. Decimal values are rejected
 * instead of rounded. Positive quantities/DC must be safe integers >= 1 and
 * gold costs must be safe integers >= 0.
 */
export function validateRecipeImportNumbers(data = {}) {
  const errors = [];
  const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
  recipes.forEach((recipe, index) => validateRecipe(errors, recipe, `recipes[${index}]`));
  return { ok: errors.length === 0, errors };
}

export function assertValidRecipeImportNumbers(data = {}) {
  const result = validateRecipeImportNumbers(data);
  if (!result.ok) throw new RecipeImportValidationError(result.errors);
  return true;
}
