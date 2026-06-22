import { MODULE_ID } from "./constants.js";
import { registerSettings, setting, log } from "./settings.js";
import { CraftingApp } from "./crafting-app.js";
import { RecipeEditor } from "./recipe-editor.js";
import { CraftingEngine } from "./crafting-engine.js";
import { deconstructItem } from "./deconstruction-engine.js";
import { createSampleRecipes, deleteRecipeItem, getRecipeData, setRecipeData, createRecipeItem } from "./recipe-utils.js";
import { buildRecipeBookData, deleteSavedRecipeBook, exportRecipeBook, importRecipeBookData, openExportRecipeBookDialog, openImportRecipeBookDialog, openManageRecipeBooks, openSaveRecipeBookDialog, renameSavedRecipeBook, saveRecipeBook, updateSavedRecipeBookFromWorld } from "./recipe-books.js";

let activeApp = null;

function selectedActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const tokenActor = controlled[0]?.actor;
  if (tokenActor) return tokenActor;
  return game.user.character ?? null;
}

export function openCraftingApp(actor = null) {
  const target = actor ?? selectedActor();
  if (!target) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
    return null;
  }

  activeApp = new CraftingApp(target);
  activeApp.render(true);
  return activeApp;
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("mkSdcEq", (a, b) => a === b);
  Handlebars.registerHelper("mkSdcOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("mkSdcAbilityLabel", (ability) => game.i18n.localize(`MKSDC.Ability.${String(ability || "int").toUpperCase()}`));
  Handlebars.registerHelper("mkSdcNumber", (value) => Number(value || 0));
  Handlebars.registerHelper("mkSdcAdd", (a, b) => Number(a || 0) + Number(b || 0));
  Handlebars.registerHelper("mkSdcJson", (value) => JSON.stringify(value, null, 2));
}

function registerSceneControlButton(controls) {
  if (!setting("showSceneControl")) return;

  const tokenControls = controls.find((control) => control.name === "token");
  if (!tokenControls) return;

  tokenControls.tools.push({
    name: "mk-shadowdark-crafting",
    title: game.i18n.localize("MKSDC.Controls.OpenCrafting"),
    icon: "fas fa-hammer",
    button: true,
    visible: game.user.isGM || setting("allowPlayerCrafting"),
    onClick: () => openCraftingApp()
  });
}

function registerActorSheetButton(app, buttons) {
  if (!setting("showActorSheetButton")) return;
  const actor = app?.actor;
  if (!actor) return;
  if (!actor.isOwner && !game.user.isGM) return;

  buttons.unshift({
    label: game.i18n.localize("MKSDC.Buttons.Crafting"),
    class: "mk-sdc-open-crafting",
    icon: "fas fa-hammer",
    onclick: () => openCraftingApp(actor)
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerHandlebarsHelpers();

  window.mkShadowdarkCrafting = {
    open: openCraftingApp,
    openRecipeEditor: (item = null) => new RecipeEditor(item).render(true),
    craft: (actor, recipeUuid) => CraftingEngine.craft(actor, recipeUuid),
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

Hooks.once("ready", () => {
  if (game.system.id !== "shadowdark") {
    console.warn(`${MODULE_ID} | This module was built for the Shadowdark RPG system. Current system: ${game.system.id}`);
  }

  log("ready", { system: game.system.id, version: game.system.version });
});

Hooks.on("getSceneControlButtons", registerSceneControlButton);
Hooks.on("getActorSheetHeaderButtons", registerActorSheetButton);
