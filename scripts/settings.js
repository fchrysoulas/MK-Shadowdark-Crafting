import { MODULE_ID, SHADOWDARK_V350_ITEM_TYPES } from "./constants.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, "showActorSheetButton", {
    name: game.i18n.localize("MKSDC.Settings.ShowActorSheetButton.Name"),
    hint: game.i18n.localize("MKSDC.Settings.ShowActorSheetButton.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showSceneControl", {
    name: game.i18n.localize("MKSDC.Settings.ShowSceneControl.Name"),
    hint: game.i18n.localize("MKSDC.Settings.ShowSceneControl.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "allowPlayerCrafting", {
    name: game.i18n.localize("MKSDC.Settings.AllowPlayerCrafting.Name"),
    hint: game.i18n.localize("MKSDC.Settings.AllowPlayerCrafting.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "consumeMaterialsOnFailure", {
    name: game.i18n.localize("MKSDC.Settings.ConsumeMaterialsOnFailure.Name"),
    hint: game.i18n.localize("MKSDC.Settings.ConsumeMaterialsOnFailure.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "criticalFailureLosesAll", {
    name: game.i18n.localize("MKSDC.Settings.CriticalFailureLosesAll.Name"),
    hint: game.i18n.localize("MKSDC.Settings.CriticalFailureLosesAll.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "criticalSuccessHalfCost", {
    name: game.i18n.localize("MKSDC.Settings.CriticalSuccessHalfCost.Name"),
    hint: game.i18n.localize("MKSDC.Settings.CriticalSuccessHalfCost.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "useGoldCost", {
    name: game.i18n.localize("MKSDC.Settings.UseGoldCost.Name"),
    hint: game.i18n.localize("MKSDC.Settings.UseGoldCost.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "checkTools", {
    name: game.i18n.localize("MKSDC.Settings.CheckTools.Name"),
    hint: game.i18n.localize("MKSDC.Settings.CheckTools.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "checkStations", {
    name: game.i18n.localize("MKSDC.Settings.CheckStations.Name"),
    hint: game.i18n.localize("MKSDC.Settings.CheckStations.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "recipeItemType", {
    name: game.i18n.localize("MKSDC.Settings.RecipeItemType.Name"),
    hint: game.i18n.localize("MKSDC.Settings.RecipeItemType.Hint"),
    scope: "world",
    config: false,
    type: String,
    choices: Object.fromEntries(SHADOWDARK_V350_ITEM_TYPES.map((type) => [type, type])),
    default: "Basic"
  });

  game.settings.register(MODULE_ID, "recipeState", {
    name: "Recipe State",
    hint: "Unified recipe books and active-book state.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      schemaVersion: 3,
      initialized: false,
      revision: 0,
      lastMutationId: "",
      activeBookIds: [],
      books: {}
    }
  });

  // Legacy migration inputs. Runtime recipe storage uses recipeState.
  game.settings.register(MODULE_ID, "recipeBooks", {
    name: "Recipe Books (Legacy)",
    hint: "Legacy recipe-book storage retained for migration compatibility.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "activeRecipeBookIds", {
    name: "Active Recipe Books (Legacy)",
    hint: "Legacy active-book storage retained for migration compatibility.",
    scope: "world",
    config: false,
    type: Array,
    default: ["world-recipes"]
  });

  game.settings.register(MODULE_ID, "layoutMode", {
    name: game.i18n.localize("MKSDC.Settings.LayoutMode.Name"),
    hint: game.i18n.localize("MKSDC.Settings.LayoutMode.Hint"),
    scope: "client",
    config: false,
    type: String,
    choices: {
      dense: game.i18n.localize("MKSDC.Layout.DenseList"),
      detail: game.i18n.localize("MKSDC.Layout.MasterDetail")
    },
    default: "dense"
  });

  game.settings.register(MODULE_ID, "debug", {
    name: game.i18n.localize("MKSDC.Settings.Debug.Name"),
    hint: game.i18n.localize("MKSDC.Settings.Debug.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function log(...args) {
  if (setting("debug")) {
    console.log(`%c${MODULE_ID}`, "color:#b08d57;font-weight:bold", ...args);
  }
}
