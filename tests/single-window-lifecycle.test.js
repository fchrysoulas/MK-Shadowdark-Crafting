import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CraftingWindowRegistry } from "../scripts/crafting-window-registry.js";

const moduleSource = await readFile(path.join(process.cwd(), "scripts/module.js"), "utf8");

test("crafting windows are tracked independently per actor", () => {
  const registry = new CraftingWindowRegistry();
  const actorA = { uuid: "Actor.A" };
  const actorB = { uuid: "Actor.B" };
  const appA = { rendered: true };
  const appB = { rendered: true };

  registry.track(actorA, appA);
  registry.track(actorB, appB);

  assert.equal(registry.get(actorA)?.app, appA);
  assert.equal(registry.get(actorB)?.app, appB);
  assert.equal(registry.get(actorA)?.app, appA, "A -> B -> A must reuse A's original open window");
});

test("render-pending window stays reusable until the ApplicationV2 render promise settles", () => {
  const registry = new CraftingWindowRegistry();
  const actor = { uuid: "Actor.A" };
  const app = { rendered: false };
  const pending = new Promise(() => {});

  registry.track(actor, app);
  registry.setRenderPromise(actor, app, pending);
  assert.equal(registry.get(actor)?.app, app);

  registry.clearRenderPromise(actor, app);
  assert.equal(registry.get(actor), null);
});

test("closed actor window is discarded so reopening can create a fresh app", () => {
  const registry = new CraftingWindowRegistry();
  const actor = { uuid: "Actor.A" };
  const app = { rendered: true };

  registry.track(actor, app);
  app.rendered = false;

  assert.equal(registry.get(actor), null);
  assert.equal(registry.entries.size, 0);
});

test("module uses the per-actor registry rather than a single global app pointer", () => {
  assert.match(moduleSource, /new CraftingWindowRegistry\(\)/);
  assert.match(moduleSource, /craftingWindows\.get\(target\)/);
  assert.match(moduleSource, /craftingWindows\.track\(target, app\)/);
  assert.match(moduleSource, /craftingWindows\.setRenderPromise\(target, app, renderPromise\)/);
  assert.doesNotMatch(moduleSource, /let activeApp = null/);
  assert.doesNotMatch(moduleSource, /let activeRenderPromise = null/);
});
