import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const moduleSource = await readFile(path.join(process.cwd(), "scripts/module.js"), "utf8");

test("crafting singleton stays guarded for the full ApplicationV2 render promise", () => {
  assert.match(moduleSource, /let activeRenderPromise = null/);
  assert.match(moduleSource, /activeRenderPromise \|\| activeApp\.rendered/);
  assert.match(moduleSource, /Promise\.resolve\(app\.render\(\{ force: true \}\)\)/);
  assert.match(moduleSource, /\.finally\(\(\) => \{/);
  assert.doesNotMatch(moduleSource, /let openingApp/);
  assert.doesNotMatch(moduleSource, /window\.setTimeout\(\(\) => \{\s*openingApp = false/s);
});

test("closed non-rendering app reference is discarded so reopening still works", () => {
  assert.match(moduleSource, /if \(activeApp && sameActor\(activeApp\.actor, target\)\)/);
  assert.match(moduleSource, /if \(activeRenderPromise \|\| activeApp\.rendered\)/);
  assert.match(moduleSource, /activeApp = null;/);
});
