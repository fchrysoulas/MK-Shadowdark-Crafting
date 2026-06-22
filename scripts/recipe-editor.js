import { MODULE_ID, TEMPLATES, ABILITIES } from "./constants.js";
import { deleteRecipe, getEditableRecipeBookId, getRecipeBooks, getRecipeData, normalizeRecipeAbilities, sanitizeMaterialChoice, sanitizeOutputItemData, sanitizeRecipeData, upsertRecipe } from "./recipe-utils.js";
import { getAvailableItemTypes, getItemQuantity, resolveItemType } from "./item-utils.js";

function toArrayFromExpanded(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => value[key]);
}

function itemToRecipePart(item, uuid = "") {
  const data = item?.toObject ? sanitizeOutputItemData(item.toObject(), item) : null;
  return {
    name: item?.name ?? "",
    uuid: uuid || item?.uuid || "",
    type: item?.type ?? "",
    img: item?.img || "icons/svg/item-bag.svg",
    qty: Math.max(1, Number(item?.qty ?? (item ? getItemQuantity(item) : 1) ?? 1)),
    outputItemData: data
  };
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function getNativeDropEvent(event) {
  return event?.originalEvent ?? event;
}

function parseDroppedData(event) {
  const dropEvent = getNativeDropEvent(event);
  const dataTransfer = dropEvent?.dataTransfer;

  if (!dataTransfer) return null;

  try {
    return TextEditor.getDragEventData(dropEvent);
  } catch (error) {
    const raw = dataTransfer.getData("text/plain")
      || dataTransfer.getData("application/json")
      || "";

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (_error) {
      console.warn(`${MODULE_ID} | Could not parse dropped item data`, error, raw);
      return null;
    }
  }
}

async function getDroppedItem(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  const data = parseDroppedData(event);

  if (!data || data.type !== "Item") {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.DropItemOnly"));
    return null;
  }

  let item = null;
  if (data.uuid) {
    try {
      item = await fromUuid(data.uuid);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not resolve dropped UUID`, data.uuid, error);
    }
  }

  if (!item && data.pack && data.id) {
    const pack = game.packs?.get(data.pack);
    if (pack) item = await pack.getDocument(data.id);
  }

  if (!item && data.id) item = game.items?.get(data.id) ?? null;

  if (!item) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.DroppedItemNotFound"));
    return null;
  }

  return { item, uuid: data.uuid || item.uuid || "" };
}

function materialChoiceHtml(material, groupIndex, altIndex) {
  const safe = sanitizeMaterialChoice(material);
  return `
    <li class="mk-sdc-material-choice" data-material-choice data-alt-index="${altIndex}">
      <img src="${escapeHtml(safe.img)}" alt="${escapeHtml(safe.name)}">
      <div class="mk-sdc-material-main">
        <input type="text" name="materialGroups.${groupIndex}.alternatives.${altIndex}.name" value="${escapeHtml(safe.name)}" placeholder="${escapeHtml(game.i18n.localize("MKSDC.Editor.MaterialName"))}">
        <input type="hidden" name="materialGroups.${groupIndex}.alternatives.${altIndex}.uuid" value="${escapeHtml(safe.uuid)}">
        <input type="hidden" name="materialGroups.${groupIndex}.alternatives.${altIndex}.type" value="${escapeHtml(safe.type)}">
        <input type="hidden" name="materialGroups.${groupIndex}.alternatives.${altIndex}.img" value="${escapeHtml(safe.img)}">
        <div class="mk-sdc-material-meta">${escapeHtml(safe.type || game.i18n.localize("MKSDC.Editor.ManualMaterial"))}</div>
      </div>
      <div class="mk-sdc-material-qty">
        <label>${escapeHtml(game.i18n.localize("MKSDC.Editor.Quantity"))}</label>
        <input type="number" name="materialGroups.${groupIndex}.alternatives.${altIndex}.qty" value="${safe.qty}" min="1" step="1">
      </div>
      <button type="button" class="mk-sdc-icon-button" data-action="remove-material-choice" title="${escapeHtml(game.i18n.localize("MKSDC.Buttons.Remove"))}">
        <i class="fas fa-trash"></i>
      </button>
    </li>`;
}

function materialGroupHtml(group, groupIndex) {
  const alternatives = Array.isArray(group?.alternatives) ? group.alternatives : [];
  const choiceHtml = alternatives.length
    ? alternatives.map((material, altIndex) => materialChoiceHtml(material, groupIndex, altIndex)).join("")
    : materialChoiceHtml({}, groupIndex, 0);

  return `
    <li class="mk-sdc-material-group-row" data-material-group data-group-index="${groupIndex}">
      <div class="mk-sdc-material-group-header">
        <strong>${escapeHtml(game.i18n.format("MKSDC.Editor.RequirementRow", { number: groupIndex + 1 }))}</strong>
        <span>${escapeHtml(game.i18n.localize("MKSDC.Editor.SubstitutesHintShort"))}</span>
        <button type="button" class="mk-sdc-icon-button" data-action="remove-material-group" title="${escapeHtml(game.i18n.localize("MKSDC.Buttons.Remove"))}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <ul class="mk-sdc-material-alternative-list" data-alternative-list>
        ${choiceHtml}
      </ul>
      <div class="mk-sdc-drop-zone mk-sdc-material-alternative-drop" data-drop-target="material-group">
        <i class="fas fa-plus"></i>
        <span>${escapeHtml(game.i18n.localize("MKSDC.Editor.AlternativeDropHint"))}</span>
        <button type="button" data-action="add-material-choice"><i class="fas fa-plus"></i> ${escapeHtml(game.i18n.localize("MKSDC.Buttons.AddSubstitute"))}</button>
      </div>
    </li>`;
}

function deconstructMaterialHtml(material, index) {
  const safe = sanitizeMaterialChoice(material);
  return `
    <li class="mk-sdc-material-choice mk-sdc-deconstruct-material-row" data-deconstruct-material-row data-deconstruct-material-index="${index}">
      <img src="${escapeHtml(safe.img)}" alt="${escapeHtml(safe.name)}">
      <div class="mk-sdc-material-main">
        <input type="text" name="deconstructMaterials.${index}.name" value="${escapeHtml(safe.name)}" placeholder="${escapeHtml(game.i18n.localize("MKSDC.Editor.MaterialName"))}">
        <input type="hidden" name="deconstructMaterials.${index}.uuid" value="${escapeHtml(safe.uuid)}">
        <input type="hidden" name="deconstructMaterials.${index}.type" value="${escapeHtml(safe.type)}">
        <input type="hidden" name="deconstructMaterials.${index}.img" value="${escapeHtml(safe.img)}">
        <div class="mk-sdc-material-meta">${escapeHtml(safe.type || game.i18n.localize("MKSDC.Editor.ManualMaterial"))}</div>
      </div>
      <div class="mk-sdc-material-qty">
        <label>${escapeHtml(game.i18n.localize("MKSDC.Editor.Quantity"))}</label>
        <input type="number" name="deconstructMaterials.${index}.qty" value="${safe.qty}" min="1" step="1">
      </div>
      <button type="button" class="mk-sdc-icon-button" data-action="remove-deconstruct-material" title="${escapeHtml(game.i18n.localize("MKSDC.Buttons.Remove"))}">
        <i class="fas fa-trash"></i>
      </button>
    </li>`;
}

function extractDeconstructMaterials(expanded = {}) {
  return toArrayFromExpanded(expanded.deconstructMaterials)
    .map(sanitizeMaterialChoice)
    .filter((material) => material.name && material.qty > 0);
}

function extractDeconstructMaterialsFromForm(form) {
  const rowElements = Array.from(form?.querySelectorAll?.("[data-deconstruct-material-row]") ?? []);

  return rowElements
    .map((rowElement) => sanitizeMaterialChoice({
      name: getInputValue(rowElement, ".name"),
      uuid: getInputValue(rowElement, ".uuid"),
      type: getInputValue(rowElement, ".type"),
      img: getInputValue(rowElement, ".img", "icons/svg/item-bag.svg"),
      qty: getInputValue(rowElement, ".qty", 1)
    }))
    .filter((material) => material.name && material.qty > 0);
}

function extractMaterialGroups(expanded = {}) {
  return toArrayFromExpanded(expanded.materialGroups)
    .map((group) => ({
      alternatives: toArrayFromExpanded(group?.alternatives)
        .map(sanitizeMaterialChoice)
        .filter((material) => material.name && material.qty > 0)
    }))
    .filter((group) => group.alternatives.length > 0);
}

function getInputValue(element, suffix, fallback = "") {
  const input = element?.querySelector?.(`input[name$="${suffix}"], textarea[name$="${suffix}"], select[name$="${suffix}"]`);
  return input ? input.value : fallback;
}

function extractMaterialGroupsFromForm(form) {
  const groupElements = Array.from(form?.querySelectorAll?.("[data-material-group]") ?? []);

  return groupElements
    .map((groupElement) => {
      const choices = Array.from(groupElement.querySelectorAll("[data-material-choice]"))
        .map((choiceElement) => sanitizeMaterialChoice({
          name: getInputValue(choiceElement, ".name"),
          uuid: getInputValue(choiceElement, ".uuid"),
          type: getInputValue(choiceElement, ".type"),
          img: getInputValue(choiceElement, ".img", "icons/svg/item-bag.svg"),
          qty: getInputValue(choiceElement, ".qty", 1)
        }))
        .filter((material) => material.name && material.qty > 0);

      return { alternatives: choices };
    })
    .filter((group) => group.alternatives.length > 0);
}

export class RecipeEditor extends FormApplication {
  constructor(recipe = null, options = {}) {
    super(recipe, options);
    this.recipe = recipe ? getRecipeData(recipe) : null;
    this._nextMaterialGroupIndex = 0;
    this._nextDeconstructMaterialIndex = 0;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mk-shadowdark-recipe-editor",
      classes: ["mk-sdc", "mk-sdc-editor"],
      title: game.i18n.localize("MKSDC.Editor.Title"),
      template: TEMPLATES.RECIPE_EDITOR,
      width: 760,
      height: "auto",
      resizable: true,
      closeOnSubmit: true
    });
  }

  async getData() {
    const recipe = this.recipe ? getRecipeData(this.recipe) : sanitizeRecipeData({ bookId: getEditableRecipeBookId() });
    const itemTypes = getAvailableItemTypes();
    const books = getRecipeBooks();
    const bookOptions = Object.entries(books).map(([id, book]) => ({ id, name: book.name || id, selected: id === recipe.bookId }));
    if (!bookOptions.some((book) => book.id === recipe.bookId)) {
      const id = recipe.bookId || getEditableRecipeBookId();
      bookOptions.unshift({
        id,
        name: books[id]?.name || game.i18n.localize("MKSDC.RecipeBooks.WorldRecipesName") || id,
        selected: true
      });
    }

    recipe.outputImg = recipe.outputImg || "icons/svg/item-bag.svg";
    recipe.materialGroups = recipe.materialGroups ?? [];
    recipe.deconstructMaterials = recipe.deconstructMaterials ?? [];
    this._nextMaterialGroupIndex = Math.max(recipe.materialGroups.length, this._nextMaterialGroupIndex || 0);
    this._nextDeconstructMaterialIndex = Math.max(recipe.deconstructMaterials.length, this._nextDeconstructMaterialIndex || 0);

    return {
      moduleId: MODULE_ID,
      isEdit: Boolean(this.recipe?.id),
      itemTypes,
      bookOptions,
      abilityOptions: ABILITIES.map((ability) => ({
        value: ability,
        label: game.i18n.localize(`MKSDC.Ability.${ability.toUpperCase()}`),
        checked: (recipe.abilities ?? [recipe.ability]).includes(ability)
      })),
      recipe,
      hasMaterials: recipe.materialGroups.length > 0,
      hasDeconstructMaterials: recipe.deconstructMaterials.length > 0,
      canDelete: Boolean(this.recipe?.id && game.user.isGM)
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const outputTypeSelect = html.find("[name='recipe.outputType']");
    outputTypeSelect.data("previousOutputType", outputTypeSelect.val() || "Basic");
    outputTypeSelect.on("change", (event) => {
      const select = $(event.currentTarget);
      const previousOutputType = String(select.data("previousOutputType") || "Basic");
      const nextOutputType = String(select.val() || "Basic");
      const categoryInput = html.find("[name='recipe.category']");
      const currentCategory = String(categoryInput.val() || "").trim();
      if (categoryInput.length && (!currentCategory || currentCategory === previousOutputType)) categoryInput.val(nextOutputType);
      select.data("previousOutputType", nextOutputType);
    });

    html.find("[data-action='clear-output']").on("click", (event) => {
      event.preventDefault();
      this._setOutputFields(html, {
        name: "New Crafted Item",
        uuid: "",
        type: resolveItemType("Basic", "Basic"),
        img: "icons/svg/item-bag.svg",
        qty: 1
      });
    });

    html.find("[data-action='add-material']").on("click", (event) => {
      event.preventDefault();
      this._appendMaterialGroup(html, { alternatives: [{}] });
    });

    html.find("[data-action='add-deconstruct-material']").on("click", (event) => {
      event.preventDefault();
      this._appendDeconstructMaterial(html, {});
    });

    html.on("click", "[data-action='add-material-choice']", (event) => {
      event.preventDefault();
      const group = event.currentTarget.closest("[data-material-group]");
      if (!group) return;
      this._appendMaterialChoice(group, {});
    });

    html.on("click", "[data-action='remove-material-choice']", (event) => {
      event.preventDefault();
      const group = event.currentTarget.closest("[data-material-group]");
      event.currentTarget.closest("[data-material-choice]")?.remove();
      if (group && !group.querySelector("[data-material-choice]")) group.remove();
      this._toggleEmptyMaterials(html);
    });

    html.on("click", "[data-action='remove-material-group']", (event) => {
      event.preventDefault();
      event.currentTarget.closest("[data-material-group]")?.remove();
      this._toggleEmptyMaterials(html);
    });

    html.on("click", "[data-action='remove-deconstruct-material']", (event) => {
      event.preventDefault();
      event.currentTarget.closest("[data-deconstruct-material-row]")?.remove();
      this._toggleEmptyDeconstructMaterials(html);
    });

    html.find("[data-drop-target='output']").on("dragover", (event) => {
      event.preventDefault();
      event.currentTarget.classList.add("drag-hover");
    });

    html.find("[data-drop-target='output']").on("dragleave", (event) => {
      event.currentTarget.classList.remove("drag-hover");
    });

    html.find("[data-drop-target='output']").on("drop", async (event) => {
      const dropTarget = event.currentTarget;
      dropTarget.classList.remove("drag-hover");
      const dropped = await getDroppedItem(event);
      if (!dropped) return;
      const data = itemToRecipePart(dropped.item, dropped.uuid);
      this._setOutputFields(html, data);
    });

    html.find("[data-drop-target='materials']").on("dragover", (event) => {
      event.preventDefault();
      event.currentTarget.classList.add("drag-hover");
    });

    html.find("[data-drop-target='materials']").on("dragleave", (event) => {
      event.currentTarget.classList.remove("drag-hover");
    });

    html.find("[data-drop-target='materials']").on("drop", async (event) => {
      const dropTarget = event.currentTarget;
      dropTarget.classList.remove("drag-hover");
      const dropped = await getDroppedItem(event);
      if (!dropped) return;
      this._appendMaterialGroup(html, {
        alternatives: [{
          ...itemToRecipePart(dropped.item, dropped.uuid),
          qty: 1
        }]
      });
    });

    html.find("[data-drop-target='deconstruct-materials']").on("dragover", (event) => {
      event.preventDefault();
      event.currentTarget.classList.add("drag-hover");
    });

    html.find("[data-drop-target='deconstruct-materials']").on("dragleave", (event) => {
      event.currentTarget.classList.remove("drag-hover");
    });

    html.find("[data-drop-target='deconstruct-materials']").on("drop", async (event) => {
      const dropTarget = event.currentTarget;
      dropTarget.classList.remove("drag-hover");
      const dropped = await getDroppedItem(event);
      if (!dropped) return;
      this._appendDeconstructMaterial(html, {
        ...itemToRecipePart(dropped.item, dropped.uuid),
        qty: 1
      });
    });

    html.on("dragover", "[data-drop-target='material-group']", (event) => {
      event.preventDefault();
      event.currentTarget.classList.add("drag-hover");
    });

    html.on("dragleave", "[data-drop-target='material-group']", (event) => {
      event.currentTarget.classList.remove("drag-hover");
    });

    html.on("drop", "[data-drop-target='material-group']", async (event) => {
      const dropTarget = event.currentTarget;
      dropTarget.classList.remove("drag-hover");
      const dropped = await getDroppedItem(event);
      if (!dropped) return;
      const group = dropTarget.closest("[data-material-group]");
      if (!group) return;
      this._appendMaterialChoice(group, {
        ...itemToRecipePart(dropped.item, dropped.uuid),
        qty: 1
      });
    });

    html.find("[data-action='delete-recipe']").on("click", async (event) => {
      event.preventDefault();
      if (!this.recipe?.id) return;

      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("MKSDC.Dialog.DeleteRecipeTitle"),
        content: `<p>${game.i18n.format("MKSDC.Dialog.DeleteRecipeContent", { name: escapeHtml(this.recipe.outputName) })}</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });

      if (!confirmed) return;
      const deleted = await deleteRecipe(this.recipe.id, { bookId: this.recipe.bookId });
      if (deleted) this.close();
    });
  }

  _setOutputFields(html, data) {
    const safe = {
      name: data?.name || "New Crafted Item",
      uuid: data?.uuid || "",
      type: data?.type || "Basic",
      img: data?.img || "icons/svg/item-bag.svg",
      qty: Math.max(1, Number(data?.qty || 1)),
      outputItemData: data?.outputItemData ?? null
    };
    const type = resolveItemType(safe.type || "Basic", "Basic");

    const categoryInput = html.find("[name='recipe.category']");
    const previousOutputType = html.find("[name='recipe.outputType']").val() || "Basic";
    const currentCategory = String(categoryInput.val() || "").trim();

    html.find("[name='recipe.outputName']").val(safe.name || "New Crafted Item");
    html.find("[name='recipe.outputUuid']").val(safe.uuid || "");
    html.find("[name='recipe.outputType']").val(type).data("previousOutputType", type);
    if (categoryInput.length && (!currentCategory || currentCategory === previousOutputType)) categoryInput.val(type);
    html.find("[name='recipe.outputImg']").val(safe.img || "icons/svg/item-bag.svg");
    html.find("[name='recipe.outputQty']").val(Math.max(1, Number(safe.qty || 1)));
    html.find("[name='recipe.outputItemData']").val(JSON.stringify(safe.outputItemData || null));
    html.find("[data-output-img]").attr("src", safe.img || "icons/svg/item-bag.svg");
    html.find("[data-output-title]").text(safe.name || game.i18n.localize("MKSDC.Editor.NoOutputItem"));
    html.find("[data-output-subtitle]").text(safe.uuid ? `${type} - ${safe.uuid}` : game.i18n.localize("MKSDC.Editor.OutputManualHint"));
  }

  _appendMaterialGroup(html, group) {
    const list = html.find("[data-material-list]");
    const index = this._nextMaterialGroupIndex++;
    list.append(materialGroupHtml(group, index));
    this._toggleEmptyMaterials(html);
  }

  _appendMaterialChoice(groupElement, material) {
    const groupIndex = Number(groupElement.dataset.groupIndex || 0);
    const list = groupElement.querySelector("[data-alternative-list]");
    if (!list) return;
    const existing = Array.from(groupElement.querySelectorAll("[data-material-choice]")).map((el) => Number(el.dataset.altIndex || 0));
    const altIndex = existing.length ? Math.max(...existing) + 1 : 0;
    list.insertAdjacentHTML("beforeend", materialChoiceHtml(material, groupIndex, altIndex));
  }

  _appendDeconstructMaterial(html, material) {
    const list = html.find("[data-deconstruct-material-list]");
    const index = this._nextDeconstructMaterialIndex++;
    list.append(deconstructMaterialHtml(material, index));
    this._toggleEmptyDeconstructMaterials(html);
  }

  _toggleEmptyMaterials(html) {
    const hasRows = html.find("[data-material-group]").length > 0;
    html.find("[data-material-empty]").toggle(!hasRows);
  }

  _toggleEmptyDeconstructMaterials(html) {
    const hasRows = html.find("[data-deconstruct-material-row]").length > 0;
    html.find("[data-deconstruct-material-empty]").toggle(!hasRows);
  }

  async _updateObject(event, formData) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
      return;
    }

    const expanded = foundry.utils.expandObject(formData);
    const form = event?.currentTarget ?? this.form;
    const materialGroupsFromDom = extractMaterialGroupsFromForm(form);
    const materialGroupsFromFormData = extractMaterialGroups(expanded);
    const materialGroups = materialGroupsFromDom.length || form?.querySelector?.("[data-material-group]")
      ? materialGroupsFromDom
      : materialGroupsFromFormData;

    const deconstructMaterialsFromDom = extractDeconstructMaterialsFromForm(form);
    const deconstructMaterialsFromFormData = extractDeconstructMaterials(expanded);
    const deconstructMaterials = deconstructMaterialsFromDom.length || form?.querySelector?.("[data-deconstruct-material-row]")
      ? deconstructMaterialsFromDom
      : deconstructMaterialsFromFormData;

    const recipe = sanitizeRecipeData({
      ...(expanded.recipe ?? {}),
      abilities: normalizeRecipeAbilities(expanded.recipe ?? {}),
      materialGroups,
      deconstructGenerated: deconstructMaterials.length ? false : expanded.recipe?.deconstructGenerated,
      deconstructMaterials
    });

    const wasEdit = Boolean(this.recipe?.id);
    const previousBookId = String(this.recipe?.bookId || "").trim();
    const saved = await upsertRecipe(recipe, { bookId: recipe.bookId || getEditableRecipeBookId() });
    if (!saved) return;
    if (wasEdit && previousBookId && previousBookId !== saved.bookId) {
      await deleteRecipe(saved.id, { bookId: previousBookId, notify: false });
    }
    this.recipe = saved;
    ui.notifications.info(game.i18n.localize(wasEdit ? "MKSDC.Notifications.RecipeUpdated" : "MKSDC.Notifications.RecipeCreated"));
  }
}
