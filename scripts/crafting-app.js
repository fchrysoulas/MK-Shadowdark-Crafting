import { MODULE_ID, TEMPLATES } from "./constants.js";
import { setting } from "./settings.js";
import { CraftingEngine } from "./crafting-engine.js";
import { deconstructItem, getInventoryDeconstructionEntriesForActor } from "./deconstruction-engine.js";
import { getAvailableResourceActors, getBasicMaterialTotalsForActors } from "./item-utils.js";
import { checkRecipeRequirements, deleteRecipe, ensureDefaultRecipeBook, getRecipeById, getRecipeEntriesForActor } from "./recipe-utils.js";
import { RecipeEditor } from "./recipe-editor.js";
import { openManageRecipeBooks } from "./recipe-books.js";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function parseTimeValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return Number.MAX_SAFE_INTEGER;
  const match = text.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/i);
  if (!match) return Number.MAX_SAFE_INTEGER - 1000;
  const amount = Number(match[1] || 0);
  const unit = match[2] || "";
  if (unit.startsWith("m")) return amount;
  if (unit.startsWith("h")) return amount * 60;
  if (unit.startsWith("d")) return amount * 1440;
  if (unit.startsWith("w")) return amount * 10080;
  if (unit.startsWith("down")) return amount * 1440;
  return amount;
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clearTimer(timer) {
  if (timer) window.clearTimeout(timer);
}

export class CraftingApp extends Application {
  constructor(actor = null, options = {}) {
    super(options);
    this.actor = actor;
    this.selectedGroupType = options.selectedGroupType ?? "__all__";
    this.searchTerm = options.searchTerm ?? "";
    this.sortMode = options.sortMode ?? "name-asc";
    this.layoutMode = options.layoutMode ?? setting("layoutMode") ?? "dense";
    this.selectedRecipeId = options.selectedRecipeId ?? null;
    this.mode = options.mode ?? "craft";
    this.deconstructSearchTerm = options.deconstructSearchTerm ?? "";
    this.selectedResourceActorIds = Array.isArray(options.selectedResourceActorIds) ? options.selectedResourceActorIds.slice() : null;
    this._searchRenderTimer = null;
    this._restoreSearchFocus = false;
    this._searchSelectionStart = null;
    this._searchSelectionEnd = null;
    this._restoreSearchAction = "search";
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mk-shadowdark-crafting-app",
      classes: ["mk-sdc", "mk-sdc-app"],
      title: game.i18n.localize("MKSDC.App.Title"),
      template: TEMPLATES.CRAFTING_APP,
      width: 1080,
      height: 760,
      resizable: true
    });
  }

  async close(options = {}) {
    clearTimer(this._searchRenderTimer);
    this._searchRenderTimer = null;
    return super.close(options);
  }

  _scheduleSearchRender(action = "search") {
    clearTimer(this._searchRenderTimer);
    this._restoreSearchFocus = true;
    this._restoreSearchAction = action || "search";
    this._searchRenderTimer = window.setTimeout(() => {
      this._searchRenderTimer = null;
      this.render(false);
    }, 160);
  }

  _restoreSearchInputFocus(html) {
    if (!this._restoreSearchFocus) return;

    const action = String(this._restoreSearchAction || "search").replace(/[^a-z0-9_-]/gi, "");
    const input = html.find(`[data-action='${action}']`)[0];
    if (!input) return;

    window.setTimeout(() => {
      input.focus();
      const start = Number.isInteger(this._searchSelectionStart) ? this._searchSelectionStart : input.value.length;
      const end = Number.isInteger(this._searchSelectionEnd) ? this._searchSelectionEnd : start;
      try {
        input.setSelectionRange(start, end);
      } catch (_error) {
        // Some input types do not support selection ranges.
      }
    }, 0);
  }

  _sortRecipes(recipes = []) {
    const collator = new Intl.Collator(game.i18n.lang, { sensitivity: "base", numeric: true });
    const list = recipes.slice();

    switch (this.sortMode) {
      case "dc-asc":
        list.sort((a, b) => (Number(a.recipe.dc || 0) - Number(b.recipe.dc || 0)) || collator.compare(a.name, b.name));
        break;
      case "time-asc":
        list.sort((a, b) => (parseTimeValue(a.recipe.time) - parseTimeValue(b.recipe.time)) || collator.compare(a.name, b.name));
        break;
      case "name-desc":
        list.sort((a, b) => collator.compare(b.name, a.name));
        break;
      case "name-asc":
      default:
        list.sort((a, b) => collator.compare(a.name, b.name));
        break;
    }

    return list;
  }

  _matchesSearch(entry) {
    const needle = normalizeSearchText(this.searchTerm);
    if (!needle) return true;

    const haystack = [
      entry.name,
      entry.groupType,
      entry.abilityLabel,
      entry.recipe.time,
      ...(entry.requirements.materialGroups || []).flatMap((group) => (group.alternatives || []).map((alt) => `${alt.name} ${alt.qty}`)),
      entry.recipe.toolRequired,
      entry.recipe.stationRequired,
      entry.recipe.notes
    ].join(" ").toLowerCase();

    return haystack.includes(needle);
  }

  _matchesDeconstructSearch(entry) {
    const needle = normalizeSearchText(this.deconstructSearchTerm);
    if (!needle) return true;

    const haystack = [
      entry.name,
      entry.type,
      entry.recipeName,
      entry.refundSummary,
      ...(entry.refundMaterials || []).map((material) => `${material.name} ${material.qty}`)
    ].join(" ").toLowerCase();

    return haystack.includes(needle);
  }


  _getResourceActorState() {
    const available = getAvailableResourceActors(this.actor);
    const availableIds = new Set(available.map((entry) => entry.id));

    if (this.selectedResourceActorIds === null) {
      this.selectedResourceActorIds = available.map((entry) => entry.id);
    } else {
      this.selectedResourceActorIds = this.selectedResourceActorIds
        .map((id) => String(id || "").trim())
        .filter((id) => availableIds.has(id));
    }

    const selected = new Set(this.selectedResourceActorIds);
    const rows = available.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      img: entry.img,
      checked: selected.has(entry.id),
      primary: entry.primary,
      order: index + 1,
      sourceLabel: entry.primary ? game.i18n.localize("MKSDC.App.Crafter") : ""
    }));

    return {
      rows,
      actors: available.filter((entry) => selected.has(entry.id)).map((entry) => entry.actor)
    };
  }

  _getSelectedResourceActorIds() {
    if (this.selectedResourceActorIds === null) this._getResourceActorState();
    return Array.isArray(this.selectedResourceActorIds) ? this.selectedResourceActorIds.slice() : [];
  }

  async getData() {
    await ensureDefaultRecipeBook();
    const actor = this.actor;
    const resourceState = this._getResourceActorState();
    const recipeEntries = actor ? getRecipeEntriesForActor(actor) : [];
    const neededMaterials = recipeEntries.flatMap((entry) => {
      return (entry.recipe?.materialGroups ?? []).flatMap((group) => group.alternatives ?? []);
    });
    const resourceMaterialTotals = getBasicMaterialTotalsForActors(resourceState.actors, neededMaterials);

    const recipes = recipeEntries.map((entry) => {
      const recipe = entry.recipe;
      const requirements = actor ? checkRecipeRequirements(actor, recipe, { resourceActors: resourceState.actors }) : { ok: false, missing: [], materialRows: [], materialGroups: [] };
      return {
        uuid: recipe.id,
        id: recipe.id,
        key: entry.key,
        bookId: entry.bookId,
        bookName: entry.bookName,
        name: recipe.outputName,
        img: recipe.outputImg,
        groupType: recipe.category || recipe.outputType || game.i18n.localize("MKSDC.App.OtherGroup"),
        abilityLabel: (recipe.abilities ?? [recipe.ability]).map((ability) => game.i18n.localize(`MKSDC.Ability.${String(ability || "int").toUpperCase()}`)).join(" / "),
        isEditable: game.user.isGM,
        isDeletable: game.user.isGM,
        recipe,
        requirements,
        hasExtraRequirements: Boolean(recipe.toolRequired || recipe.stationRequired || recipe.goldCost),
        canCraft: Boolean(actor && requirements.ok && (game.user.isGM || setting("allowPlayerCrafting")))
      };
    });

    const groupMap = new Map();
    for (const entry of recipes) {
      const groupName = String(entry.groupType || game.i18n.localize("MKSDC.App.OtherGroup")).trim() || game.i18n.localize("MKSDC.App.OtherGroup");
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName).push(entry);
    }

    const recipeGroups = Array.from(groupMap, ([name, entries]) => ({
      name,
      icon: entries[0]?.img || "icons/svg/item-bag.svg",
      count: entries.length,
      recipes: this._sortRecipes(entries)
    })).sort((a, b) => a.name.localeCompare(b.name));

    const availableGroupNames = new Set(recipeGroups.map((group) => group.name));
    if (this.selectedGroupType !== "__all__" && !availableGroupNames.has(this.selectedGroupType)) {
      this.selectedGroupType = "__all__";
    }

    const activeGroup = recipeGroups.find((group) => group.name === this.selectedGroupType) ?? null;
    let visibleRecipes = this.selectedGroupType === "__all__"
      ? this._sortRecipes(recipes)
      : (activeGroup?.recipes ?? []);

    visibleRecipes = visibleRecipes.filter((entry) => this._matchesSearch(entry));

    if (visibleRecipes.length && !visibleRecipes.some((entry) => entry.key === this.selectedRecipeId)) {
      this.selectedRecipeId = visibleRecipes[0].key;
    }

    const selectedEntry = visibleRecipes.find((entry) => entry.key === this.selectedRecipeId) ?? visibleRecipes[0] ?? null;
    for (const entry of visibleRecipes) {
      entry.active = selectedEntry?.key === entry.key;
    }

    const groupTree = [
      {
        key: "__all__",
        name: game.i18n.localize("MKSDC.App.AllRecipes"),
        icon: null,
        count: recipes.length,
        active: this.selectedGroupType === "__all__"
      },
      ...recipeGroups.map((group) => ({
        key: group.name,
        name: group.name,
        icon: group.icon,
        count: group.count,
        active: this.selectedGroupType === group.name
      }))
    ];

    const sortOptions = [
      { value: "name-asc", label: game.i18n.localize("MKSDC.App.Sort.NameAZ"), selected: this.sortMode === "name-asc" },
      { value: "name-desc", label: game.i18n.localize("MKSDC.App.Sort.NameZA"), selected: this.sortMode === "name-desc" },
      { value: "dc-asc", label: game.i18n.localize("MKSDC.App.Sort.DCAsc"), selected: this.sortMode === "dc-asc" },
      { value: "time-asc", label: game.i18n.localize("MKSDC.App.Sort.TimeAsc"), selected: this.sortMode === "time-asc" }
    ];

    const layoutOptions = [
      { value: "dense", label: game.i18n.localize("MKSDC.Layout.DenseList"), selected: this.layoutMode === "dense" },
      { value: "detail", label: game.i18n.localize("MKSDC.Layout.MasterDetail"), selected: this.layoutMode === "detail" }
    ];

    const deconstructItems = actor ? getInventoryDeconstructionEntriesForActor(actor) : [];
    const deconstructVisibleItems = deconstructItems.filter((entry) => this._matchesDeconstructSearch(entry));

    return {
      moduleId: MODULE_ID,
      actor,
      hasActor: Boolean(actor),
      actorName: actor?.name ?? "",
      actorImg: actor?.img ?? "icons/svg/mystery-man.svg",
      recipes,
      recipeGroups,
      groupTree,
      activeGroupName: this.selectedGroupType === "__all__" ? game.i18n.localize("MKSDC.App.AllRecipes") : this.selectedGroupType,
      visibleRecipes,
      visibleRecipeCount: visibleRecipes.length,
      hasRecipes: recipes.length > 0,
      hasVisibleRecipes: visibleRecipes.length > 0,
      isGM: game.user.isGM,
      allowPlayerCrafting: setting("allowPlayerCrafting"),
      hasSavedRecipeBooks: Object.keys(setting("recipeBooks") || {}).length > 0,
      checkTools: setting("checkTools"),
      checkStations: setting("checkStations"),
      useGoldCost: setting("useGoldCost"),
      searchTerm: this.searchTerm,
      sortMode: this.sortMode,
      sortOptions,
      layoutMode: this.layoutMode,
      layoutOptions,
      isDenseList: this.layoutMode === "dense",
      isMasterDetail: this.layoutMode === "detail",
      selectedEntry,
      resourceActors: resourceState.rows,
      hasResourceActors: resourceState.rows.length > 0,
      hasSelectedResourceActors: resourceState.actors.length > 0,
      resourceMaterialTotals,
      hasResourceMaterialTotals: resourceMaterialTotals.length > 0,
      mode: this.mode,
      isCraftMode: this.mode !== "deconstruct",
      isDeconstructMode: this.mode === "deconstruct",
      deconstructSearchTerm: this.deconstructSearchTerm,
      deconstructItems,
      deconstructVisibleItems,
      hasDeconstructItems: deconstructItems.length > 0,
      hasDeconstructVisibleItems: deconstructVisibleItems.length > 0
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._restoreSearchInputFocus(html);

    html.find("[data-action='set-mode']").on("click", (event) => {
      event.preventDefault();
      const mode = String(event.currentTarget.dataset.mode || "craft");
      this.mode = mode === "deconstruct" ? "deconstruct" : "craft";
      this._restoreSearchFocus = false;
      this.render(false);
    });

    html.find("[data-action='select-group']").on("click", (event) => {
      event.preventDefault();
      this.selectedGroupType = event.currentTarget.dataset.groupType || "__all__";
      this.selectedRecipeId = null;
      this._restoreSearchFocus = false;
      this.render(false);
    });

    html.find("[data-action='search']").on("input", (event) => {
      const input = event.currentTarget;
      this.searchTerm = String(input.value || "");
      this._searchSelectionStart = input.selectionStart;
      this._searchSelectionEnd = input.selectionEnd;
      this._scheduleSearchRender();
    });

    html.find("[data-action='search-deconstruct']").on("input", (event) => {
      const input = event.currentTarget;
      this.deconstructSearchTerm = String(input.value || "");
      this._searchSelectionStart = input.selectionStart;
      this._searchSelectionEnd = input.selectionEnd;
      this._scheduleSearchRender("search-deconstruct");
    });

    html.find("[data-action='sort']").on("change", (event) => {
      this.sortMode = String(event.currentTarget.value || "name-asc");
      this._restoreSearchFocus = false;
      this.render(false);
    });

    html.find("[data-action='layout']").on("change", async (event) => {
      this.layoutMode = String(event.currentTarget.value || "dense");
      this._restoreSearchFocus = false;
      await game.settings.set(MODULE_ID, "layoutMode", this.layoutMode);
      this.render(false);
    });

    html.find("[data-action='select-recipe']").on("click", (event) => {
      event.preventDefault();
      this.selectedRecipeId = event.currentTarget.dataset.recipeKey || event.currentTarget.dataset.recipeId || null;
      this._restoreSearchFocus = false;
      this.render(false);
    });

    html.find("[data-action='toggle-resource-actor']").on("change", (event) => {
      const id = String(event.currentTarget.dataset.actorId || "").trim();
      if (!id) return;

      const selected = new Set(this._getSelectedResourceActorIds());
      if (event.currentTarget.checked) selected.add(id);
      else selected.delete(id);

      this.selectedResourceActorIds = Array.from(selected);
      this._restoreSearchFocus = false;
      this.render(false);
    });

    html.find("[data-action='craft']").on("click", async (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      const recipeId = button.dataset.recipeId || button.dataset.recipeUuid;
      const bookId = button.dataset.bookId || "";
      button.disabled = true;
      await CraftingEngine.craft(this.actor, recipeId, { bookId, resourceActorIds: this._getSelectedResourceActorIds() });
      this.render(false);
    });

    html.find("[data-action='deconstruct']").on("click", async (event) => {
      event.preventDefault();
      if (!this.actor) return ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
      const button = event.currentTarget;
      const itemId = String(button.dataset.itemId || "").trim();
      const item = itemId ? this.actor.items?.get?.(itemId) : null;
      if (!item) return ui.notifications.warn(game.i18n.localize("MKSDC.Deconstruct.NoItem"));
      button.disabled = true;
      await deconstructItem(this.actor, item, { skipConfirm: true });
      this.render(false);
    });

    html.find("[data-action='create-recipe']").on("click", async (event) => {
      event.preventDefault();
      await ensureDefaultRecipeBook();
      new RecipeEditor(null).render(true);
    });

    html.find("[data-action='manage-recipe-books']").on("click", (event) => {
      event.preventDefault();
      openManageRecipeBooks();
    });

    html.find("[data-action='edit-recipe']").on("click", async (event) => {
      event.preventDefault();
      const recipeId = event.currentTarget.dataset.recipeId || event.currentTarget.dataset.recipeUuid;
      const bookId = event.currentTarget.dataset.bookId || "";
      const recipe = await getRecipeById(recipeId, { bookId });
      if (!recipe) return ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RecipeNotFound"));
      new RecipeEditor(recipe).render(true);
    });

    html.find("[data-action='delete-recipe']").on("click", async (event) => {
      event.preventDefault();
      const recipeId = event.currentTarget.dataset.recipeId || event.currentTarget.dataset.recipeUuid;
      const bookId = event.currentTarget.dataset.bookId || "";
      const recipe = await getRecipeById(recipeId, { bookId });
      if (!recipe) return ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RecipeNotFound"));

      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("MKSDC.Dialog.DeleteRecipeTitle"),
        content: `<p>${game.i18n.format("MKSDC.Dialog.DeleteRecipeContent", { name: escapeHtml(recipe.outputName) })}</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });

      if (!confirmed) return;
      await deleteRecipe(recipeId, { bookId });
      this.render(false);
    });

    html.find("[data-action='refresh']").on("click", (event) => {
      event.preventDefault();
      this.render(false);
    });
  }
}
