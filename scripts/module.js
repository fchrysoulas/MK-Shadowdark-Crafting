import { MODULE_ID } from "./constants.js";
import { registerSettings, setting, log } from "./settings.js";
import { CraftingApp } from "./crafting-app.js";
import { RecipeEditor } from "./recipe-editor.js";
import { CraftingEngine } from "./crafting-engine.js";
import { deconstructItem } from "./deconstruction-engine.js";
import { createSampleRecipes, deleteRecipeItem, ensureDefaultRecipeBook, getRecipeData, setRecipeData, createRecipeItem } from "./recipe-utils.js";
import { buildRecipeBookData, deleteSavedRecipeBook, exportRecipeBook, importRecipeBookData, openExportRecipeBookDialog, openImportRecipeBookDialog, openManageRecipeBooks, openSaveRecipeBookDialog, renameSavedRecipeBook, saveRecipeBook, updateSavedRecipeBookFromWorld } from "./recipe-books.js";
import { sanitizeStoredOutputSnapshots } from "./output-snapshot-migration.js";

let activeApp = null;
let activeRenderPromise = null;

function selectedActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const tokenActor = controlled[0]?.actor;
  if (tokenActor) return tokenActor;
  return game.user.character ?? null;
}

function sameActor(a, b) {
  if (!a || !b) return false;
  const aId = String(a.uuid || a.id || "").trim();
  const bId = String(b.uuid || b.id || "").trim();
  return Boolean(aId && bId && aId === bId);
}

export function openCraftingApp(actor = null) {
  const target = actor ?? selectedActor();
  if (!target) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
    return null;
  }

  // Reuse the same actor's application while an ApplicationV2 render Promise
  // is pending or while the window remains rendered. Once a prior window has
  // closed, rendered is false and no render Promise remains, so a fresh app is
  // allowed to be constructed normally.
  if (activeApp && sameActor(activeApp.actor, target)) {
    if (activeRenderPromise || activeApp.rendered) {
      activeApp.bringToFront?.();
      return activeApp;
    }
    activeApp = null;
  }

  const app = new CraftingApp(target);
  activeApp = app;

  try {
    activeRenderPromise = Promise.resolve(app.render({ force: true }))
      .catch((error) => {
        console.error(`${MODULE_ID} | Failed to render crafting application`, error);
        if (activeApp === app) activeApp = null;
        return null;
      })
      .finally(() => {
        if (activeApp === app) activeRenderPromise = null;
      });
    return app;
  } catch (error) {
    activeRenderPromise = null;
    if (activeApp === app) activeApp = null;
    throw error;
  }
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("mkSdcEq", (a, b) => a === b);
  Handlebars.registerHelper("mkSdcOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("mkSdcAbilityLabel", (ability) => game.i18n.localize(`MKSDC.Ability.${String(ability || "int").toUpperCase()}`));
  Handlebars.registerHelper("mkSdcNumber", (value) => Number(value || 0));
  Handlebars.registerHelper("mkSdcAdd", (a, b) => Number(a || 0) + Number(b || 0));
  Handlebars.registerHelper("mkSdcJson", (value) => JSON.stringify(value, null, 2));
}

function getTokenSceneControl(controls) {
  if (Array.isArray(controls)) return controls.find((control) => ["token", "tokens"].includes(control?.name));
  return controls?.tokens ?? controls?.token ?? null;
}

function addSceneControlTool(control, tool) {
  if (!control) return;

  if (Array.isArray(control.tools)) {
    if (!control.tools.some((entry) => entry?.name === tool.name)) {
      control.tools.push({
        ...tool,
        order: control.tools.length
      });
    }
    return;
  }

  control.tools ||= {};
  if (!control.tools[tool.name]) {
    control.tools[tool.name] = {
      ...tool,
      order: Object.keys(control.tools).length
    };
  }
}

function getSheetActor(app, { allowActorProperty = false } = {}) {
  if (app?.document?.documentName === "Actor") return app.document;
  if (app?.object?.documentName === "Actor") return app.object;
  if (allowActorProperty && app?.actor?.documentName === "Actor") return app.actor;
  if (allowActorProperty && /ActorSheet/i.test(app?.constructor?.name || "") && app?.actor) return app.actor;
  return null;
}

function registerSceneControlButton(controls) {
  if (!setting("showSceneControl")) return;

  const tokenControls = getTokenSceneControl(controls);
  if (!tokenControls) return;

  addSceneControlTool(tokenControls, {
    name: "mk-shadowdark-crafting",
    title: game.i18n.localize("MKSDC.Controls.OpenCrafting"),
    icon: "fas fa-hammer",
    button: true,
    visible: game.user.isGM || setting("allowPlayerCrafting"),
    onChange: () => openCraftingApp()
  });
}

function registerActorSheetButton(app, buttons) {
  if (!setting("showActorSheetButton")) return;
  const actor = getSheetActor(app, { allowActorProperty: true });
  if (!actor) return;
  if (!actor.isOwner && !game.user.isGM) return;

  buttons.unshift({
    label: game.i18n.localize("MKSDC.Buttons.Crafting"),
    class: "mk-sdc-open-crafting",
    icon: "fas fa-hammer",
    onclick: () => openCraftingApp(actor)
  });
}

function registerActorSheetHeaderControlV2(app, controls) {
  if (!setting("showActorSheetButton")) return;
  if (!Array.isArray(controls)) return;

  const actor = getSheetActor(app, { allowActorProperty: /ActorSheet/i.test(app?.constructor?.name || "") });
  if (!actor) return;
  if (!actor.isOwner && !game.user.isGM) return;
  if (controls.some((control) => control?.action === "mk-shadowdark-crafting")) return;

  controls.unshift({
    action: "mk-shadowdark-crafting",
    label: "MKSDC.Buttons.Crafting",
    icon: "fas fa-hammer",
    visible: true,
    onClick: () => openCraftingApp(actor)
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerHandlebarsHelpers();

  window.mkShadowdarkCrafting = {
    open: openCraftingApp,
    openRecipeEditor: (item = null) => new RecipeEditor(item).render({ force: true }),
    craft: (actor, recipeUuid, options = {}) => CraftingEngine.craft(actor, recipeUuid, options),
    deconstruct: (actor, item, options = {}) => deconstructItem(actor, item, options),
    createRecipeItem,
    createSampleRecipes,
    deleteRecipeItem,
    getRecipeData,
    setRecipeData,
    recipeBooks: {
      build: buildRecipeBookData,
      save: saveRecipeBook,
      export: exportRecipeBook,
      import: importRecipeBookData,
      openSaveDialog: openSaveRecipeBookDialog,
      openExportDialog: openExportRecipeBookDialog,
      openImportDialog: openImportRecipeBookDialog,
      openManager: openManageRecipeBooks,
      renameSaved: renameSavedRecipeBook,
      deleteSaved: deleteSavedRecipeBook,
      updateSavedFromWorld: updateSavedRecipeBookFromWorld
    }
  };

  console.log(`${MODULE_ID} | initialized`);
});

Hooks.once("ready", async () => {
  if (game.system.id !== "shadowdark") {
    console.warn(`${MODULE_ID} | This module was built for the Shadowdark RPG system. Current system: ${game.system.id}`);
  }

  if (game.user.isGM) {
    try {
      await ensureDefaultRecipeBook();
      const snapshotMigration = await sanitizeStoredOutputSnapshots();
      if (snapshotMigration.sanitizedCount > 0) {
        log("sanitized stored output snapshots", snapshotMigration);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to initialize recipe books`, error);
    }
  }

  log("ready", { system: game.system.id, version: game.system.version });
});

Hooks.on("getSceneControlButtons", registerSceneControlButton);
Hooks.on("getActorSheetHeaderButtons", registerActorSheetButton);
Hooks.on("getHeaderControlsApplicationV2", registerActorSheetHeaderControlV2);
