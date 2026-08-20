import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("primary module applications use native ApplicationV2 bases and actions", async () => {
  const crafting = await read("scripts/crafting-app.js");
  const editor = await read("scripts/recipe-editor.js");
  const books = await read("scripts/recipe-books.js");
  const base = await read("scripts/application-v2.js");

  assert.match(base, /HandlebarsApplicationMixin\(ApplicationV2\)/);
  assert.match(crafting, /class CraftingApp extends MKApplicationV2/);
  assert.match(editor, /class RecipeEditor extends MKFormApplicationV2/);
  assert.match(books, /class RecipeBookManager extends MKApplicationV2/);

  for (const source of [crafting, editor, books]) {
    assert.doesNotMatch(source, /extends\s+(?:Application|FormApplication)\b/);
    assert.doesNotMatch(source, /activateListeners\s*\(/);
    assert.match(source, /actions:\s*\{/);
  }
});

test("runtime scripts do not use legacy DialogV1 constructors or confirm", async () => {
  const names = (await readdir(path.join(root, "scripts"))).filter((name) => name.endsWith(".js"));
  for (const name of names) {
    const source = await read(path.join("scripts", name));
    assert.doesNotMatch(source, /\bnew\s+Dialog\s*\(/, `${name} still constructs legacy Dialog`);
    assert.doesNotMatch(source, /\bDialog\.confirm\s*\(/, `${name} still uses legacy Dialog.confirm`);
  }
});

test("recipe editor uses ApplicationV2 form ownership without a nested form", async () => {
  const base = await read("scripts/application-v2.js");
  const template = await read("templates/recipe-editor.hbs");

  assert.match(base, /tag:\s*"form"/);
  assert.match(base, /handler:\s*applicationFormHandler/);
  assert.doesNotMatch(template, /<form\b/i);
  assert.match(template.trimStart(), /^<div\b/);
});

test("modern DialogV2 helper is the shared dialog API", async () => {
  const base = await read("scripts/application-v2.js");
  const craftingEngine = await read("scripts/crafting-engine.js");
  const deconstruction = await read("scripts/deconstruction-engine.js");
  const books = await read("scripts/recipe-books.js");

  assert.match(base, /DialogV2/);
  assert.match(craftingEngine, /DialogV2\.wait/);
  assert.match(deconstruction, /confirmDialog/);
  assert.match(books, /DialogV2\.wait/);
});

test("single-window guard uses the ApplicationV2 focus API", async () => {
  const moduleSource = await read("scripts/module.js");
  assert.match(moduleSource, /bringToFront\?\.\(\)/);
  assert.doesNotMatch(moduleSource, /bringToTop\?\.\(\)/);
});

test("deconstruction uses the same dense row hierarchy as crafting", async () => {
  const template = await read("templates/crafting-app.hbs");
  const deconstructSection = template.slice(template.indexOf('{{#if isDeconstructMode}}'));

  assert.match(deconstructSection, /mk-sdc-recipe-row mk-sdc-deconstruct-row/);
  assert.match(deconstructSection, /mk-sdc-row-main mk-sdc-deconstruct-main/);
  assert.match(deconstructSection, /mk-sdc-row-content mk-sdc-deconstruct-copy/);
  assert.match(deconstructSection, /mk-sdc-row-materials-column mk-sdc-deconstruct-recovery/);
  assert.match(deconstructSection, /mk-sdc-row-actions/);
});

test("recipe abilities use a borderless three-column selector", async () => {
  const css = await read("styles/crafting.css");
  const abilityLayout = css.slice(css.indexOf("/* Recipe ability selector: fixed 3-by-2, without pill containers */"));

  assert.match(abilityLayout, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(abilityLayout, /\.mk-sdc \.mk-sdc-ability-check\s*\{[^}]*border:\s*0;/s);
  assert.match(abilityLayout, /\.mk-sdc \.mk-sdc-ability-check\s*\{[^}]*border-radius:\s*0;/s);
});

test("crafting header leads with the character name and reflects the active mode", async () => {
  const template = await read("templates/crafting-app.hbs");
  const header = template.slice(template.indexOf('<header class="mk-sdc-app-header'), template.indexOf('</header>'));

  assert.match(header, /\{\{actorName\}\}/);
  assert.match(header, /\{\{#if isDeconstructMode\}\}/);
  assert.match(header, /MKSDC\.Deconstruct\.Action/);
  assert.match(header, /MKSDC\.Buttons\.Crafting/);
  assert.doesNotMatch(header, /MKSDC\.App\.Title/);
});

test("deconstruct mode does not repeat an inventory heading", async () => {
  const template = await read("templates/crafting-app.hbs");
  const deconstructSection = template.slice(template.indexOf('{{#if isDeconstructMode}}'));

  assert.doesNotMatch(deconstructSection, /MKSDC\.Deconstruct\.InventoryTitle/);
  assert.doesNotMatch(deconstructSection, /MKSDC\.Deconstruct\.InventoryHint/);
});
