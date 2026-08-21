import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidRecipeImportNumbers,
  RecipeImportValidationError,
  validateRecipeImportNumbers
} from "../scripts/recipe-import-validation.js";

function bookWithRecipe(recipe) {
  return { recipes: [recipe] };
}

test("valid integer numeric strings remain import-compatible", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    outputQty: "2",
    dc: "12",
    goldCost: "0",
    materialGroups: [{ alternatives: [{ name: "Iron", qty: "3" }] }],
    deconstructMaterials: [{ name: "Iron", qty: "1" }]
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("malformed material quantity cannot silently remove the requirement", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    materialGroups: [{ alternatives: [{ name: "Iron", qty: "not-a-number" }] }]
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("materialGroups[0].alternatives[0].qty")));
  assert.throws(
    () => assertValidRecipeImportNumbers(bookWithRecipe({ materialGroups: [{ alternatives: [{ name: "Iron", qty: "oops" }] }] })),
    RecipeImportValidationError
  );
});

test("NaN and infinity are rejected before storage", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    outputQty: Number.NaN,
    dc: Number.POSITIVE_INFINITY,
    goldCost: Number.NEGATIVE_INFINITY
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test("zero and negative values are rejected where the schema requires positive integers", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    outputQty: 0,
    dc: -1,
    goldCost: -5,
    materials: [{ name: "Wood", qty: 0 }]
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
});

test("decimal values are rejected rather than silently rounded", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    outputQty: 1.5,
    dc: "12.5",
    goldCost: 2.25,
    deconstructMaterialGroups: [{ alternatives: [{ name: "Iron", qty: 0.5 }] }]
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
});

test("unsafe integers are rejected", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({
    outputQty: Number.MAX_SAFE_INTEGER + 1,
    dc: String(Number.MAX_SAFE_INTEGER + 1)
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("zero gold cost remains valid", () => {
  const result = validateRecipeImportNumbers(bookWithRecipe({ outputQty: 1, dc: 1, goldCost: 0 }));
  assert.equal(result.ok, true);
});
