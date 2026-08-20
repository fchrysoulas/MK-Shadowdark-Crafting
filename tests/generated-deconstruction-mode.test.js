import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildRecoverablePool } from "../scripts/deconstruction-refund.js";

const here = dirname(fileURLToPath(import.meta.url));
const editorTemplate = readFileSync(resolve(here, "../templates/recipe-editor.hbs"), "utf8");

test("generated deconstruction preview is not submitted as custom recovery rows", () => {
  assert.match(editorTemplate, /\{\{#if recipe\.deconstructGenerated\}\}/);
  assert.match(editorTemplate, /data-generated-deconstruction-preview/);
  assert.match(editorTemplate, /data-generated-refund-row/);

  const previewStart = editorTemplate.indexOf('<div data-generated-deconstruction-preview>');
  const dropZoneStart = editorTemplate.indexOf('<div class="mk-sdc-drop-zone mk-sdc-material-drop" data-drop-target="deconstruct-materials">', previewStart);
  assert.ok(previewStart >= 0 && dropZoneStart > previewStart, "generated preview and custom drop zone should exist");

  const preview = editorTemplate.slice(previewStart, dropZoneStart);
  assert.doesNotMatch(preview, /data-deconstruct-material-row/);
  assert.doesNotMatch(preview, /name="deconstructMaterials\./);

  const generatedCustomList = editorTemplate.indexOf('<ul class="mk-sdc-material-editor-list" data-deconstruct-material-list></ul>', dropZoneStart);
  assert.ok(generatedCustomList > dropZoneStart, "generated mode must provide an empty custom-recovery list for deliberate overrides");
});

test("generated recovery follows the actual substitute consumed", () => {
  const pool = buildRecoverablePool([
    { name: "Wood", type: "Basic", qty: 2 }
  ]);

  assert.deepEqual(pool, [
    { name: "Wood", uuid: "", type: "Basic", img: "", qty: 1 }
  ]);
  assert.equal(pool.some((entry) => entry.name === "Iron"), false);
});

test("generated recovery uses critical-success reduced consumption", () => {
  const normalPool = buildRecoverablePool([
    { name: "Wood", type: "Basic", qty: 4 }
  ]);
  const criticalSuccessPool = buildRecoverablePool([
    { name: "Wood", type: "Basic", qty: 2 }
  ]);

  assert.equal(normalPool[0].qty, 2);
  assert.equal(criticalSuccessPool[0].qty, 1);
});
