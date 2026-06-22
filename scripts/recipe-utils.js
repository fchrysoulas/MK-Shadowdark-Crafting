import { DEFAULT_BOOK_ID, DEFAULT_RECIPE, FLAGS, MODULE_ID } from "./constants.js";
import { setting, log } from "./settings.js";
import { findOwnedItemByNameForActors, getGoldInfoForActors, getOwnedMaterialQuantityForActors, normalizeResourceActors, resolveItemType } from "./item-utils.js";

const VALID_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

function randomId(prefix = "recipe") {
  const id = foundry.utils.randomID?.(16) || crypto.randomUUID?.() || `${Date.now()}${Math.floor(Math.random() * 9999)}`;
  return `${prefix}-${id}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeRecipeAbilities(data = {}) {
  const source = data.abilities;
  let abilities = [];

  if (Array.isArray(source)) {
    abilities = source;
  } else if (source && typeof source === "object") {
    abilities = Object.entries(source)
      .filter(([, value]) => value === true || value === "true" || value === "on" || value === "1" || value === 1)
      .map(([key]) => key);
  }

  const legacy = String(data.ability || "").toLowerCase().trim();
  if (!abilities.length && legacy) abilities = [legacy];
  if (!abilities.length) abilities = ["int"];

  return Array.from(new Set(abilities
    .map((ability) => String(ability || "").toLowerCase().trim())
    .filter((ability) => VALID_ABILITIES.includes(ability))
  ));
}

export function isRecipeItem(item) {
  if (!item) return false;
  const legacy = item.getFlag?.(MODULE_ID, FLAGS.IS_RECIPE);
  const recipe = item.getFlag?.(MODULE_ID, FLAGS.RECIPE);
  return Boolean(legacy || recipe?.enabled || recipe?.isRecipe);
}

export function sanitizeMaterialChoice(material = {}) {
  return {
    name: String(material.name || "").trim(),
    qty: Math.max(1, Number(material.qty || 1)),
    uuid: String(material.uuid || "").trim(),
    type: String(material.type || "").trim(),
    img: String(material.img || "icons/svg/item-bag.svg").trim()
  };
}

export function sanitizeMaterialGroup(group = {}) {
  const rawAlternatives = Array.isArray(group.alternatives)
    ? group.alternatives
    : Array.isArray(group.items)
      ? group.items
      : [];

  const alternatives = rawAlternatives
    .map(sanitizeMaterialChoice)
    .filter((material) => material.name && material.qty > 0);

  return {
    id: String(group.id || foundry.utils.randomID?.() || crypto.randomUUID?.() || Date.now()).trim(),
    alternatives
  };
}

export function normalizeMaterialGroups(data = {}) {
  const rawGroups = Array.isArray(data.materialGroups) ? data.materialGroups : [];

  if (rawGroups.length) {
    return rawGroups
      .map(sanitizeMaterialGroup)
      .filter((group) => group.alternatives.length > 0);
  }

  const legacyMaterials = Array.isArray(data.materials) ? data.materials : [];
  return legacyMaterials
    .map((material) => ({ alternatives: [material] }))
    .map(sanitizeMaterialGroup)
    .filter((group) => group.alternatives.length > 0);
}

export function normalizeDeconstructMaterials(data = {}) {
  const rawMaterials = Array.isArray(data.deconstructMaterials) ? data.deconstructMaterials : [];

  if (rawMaterials.length) {
    return rawMaterials
      .map(sanitizeMaterialChoice)
      .filter((material) => material.name && material.qty > 0);
  }

  const legacyGroups = Array.isArray(data.deconstructMaterialGroups) ? data.deconstructMaterialGroups : [];
  if (legacyGroups.length) {
    return legacyGroups
      .map(sanitizeMaterialGroup)
      .flatMap((group) => group.alternatives ?? [])
      .filter((material) => material.name && material.qty > 0);
  }

  return [];
}

function aggregateMaterials(materials = []) {
  const map = new Map();

  for (const material of materials) {
    const safe = sanitizeMaterialChoice(material);
    if (!safe.name || safe.qty <= 0) continue;

    const key = safe.uuid || `${safe.name.toLocaleLowerCase()}|${safe.type.toLocaleLowerCase()}`;
    const current = map.get(key) || { ...safe, qty: 0 };
    current.qty += safe.qty;
    map.set(key, current);
  }

  return Array.from(map.values());
}

function buildDefaultDeconstructMaterials(recipe = {}) {
  const outputQty = Math.max(1, Number(recipe.outputQty || 1));
  const materials = [];

  for (const group of recipe.materialGroups ?? []) {
    const material = group?.alternatives?.[0];
    if (!material?.name) continue;

    const perOutputQty = Math.max(0, Number(material.qty || 0)) / outputQty;
    const refundQty = Math.ceil(perOutputQty / 2);
    if (refundQty <= 0) continue;

    materials.push({
      name: material.name,
      uuid: material.uuid || "",
      type: material.type || "Basic",
      img: material.img || "icons/svg/item-bag.svg",
      qty: refundQty
    });
  }

  return aggregateMaterials(materials);
}

export function getRecipeDeconstructMaterials(recipe = {}) {
  if (recipe.deconstructEnabled === false) return [];
  return aggregateMaterials(recipe.deconstructMaterials ?? []);
}

export function hasRecipeDeconstruction(recipe = {}) {
  return getRecipeDeconstructMaterials(recipe).length > 0;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return null;
  }
}

export function sanitizeOutputItemData(data, recipe = {}) {
  const parsed = parseMaybeJson(data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const itemData = foundry.utils.deepClone(parsed);
  delete itemData._id;
  delete itemData.folder;
  delete itemData.ownership;
  delete itemData.sort;

  itemData.name = String(itemData.name || recipe.outputName || "New Crafted Item").trim() || "New Crafted Item";
  itemData.type = resolveItemType(itemData.type || recipe.outputType || "Basic", "Basic");
  itemData.img = String(itemData.img || recipe.outputImg || "icons/svg/item-bag.svg").trim();
  itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};

  if (itemData.flags?.[MODULE_ID]) {
    const moduleFlags = foundry.utils.deepClone(itemData.flags[MODULE_ID]);
    delete moduleFlags[FLAGS.IS_RECIPE];
    delete moduleFlags[FLAGS.RECIPE];
    delete moduleFlags[FLAGS.RECIPE_BOOK_ID];

    if (Object.keys(moduleFlags).length) itemData.flags[MODULE_ID] = moduleFlags;
    else delete itemData.flags[MODULE_ID];
  }

  if (itemData.flags && !Object.keys(itemData.flags).length) delete itemData.flags;
  return itemData;
}

function flattenMaterialGroups(materialGroups = []) {
  return materialGroups.flatMap((group) => group.alternatives ?? []);
}

function getRecipeBookSetting() {
  return foundry.utils.deepClone(setting("recipeBooks") || {});
}

async function setRecipeBookSetting(books) {
  await game.settings.set(MODULE_ID, "recipeBooks", books || {});
}

export function getRecipeBooks() {
  return getRecipeBookSetting();
}

export async function setRecipeBooks(books) {
  await setRecipeBookSetting(books);
}

export function getActiveRecipeBookIds() {
  const books = getRecipeBooks();
  let ids = [];
  try {
    ids = foundry.utils.deepClone(setting("activeRecipeBookIds") || []);
  } catch (_error) {
    ids = [];
  }

  const activeFromBooks = Object.entries(books)
    .filter(([, book]) => book.active)
    .map(([id]) => id);

  return Array.from(new Set([...ids, ...activeFromBooks].filter((id) => books[id])));
}

export async function setActiveRecipeBookIds(ids = []) {
  const unique = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  await game.settings.set(MODULE_ID, "activeRecipeBookIds", unique);

  const books = getRecipeBooks();
  for (const [id, book] of Object.entries(books)) {
    book.active = unique.includes(id);
  }
  await setRecipeBookSetting(books);
  return unique;
}

export async function ensureDefaultRecipeBook() {
  const books = getRecipeBooks();
  if (!books[DEFAULT_BOOK_ID]) {
    books[DEFAULT_BOOK_ID] = {
      id: DEFAULT_BOOK_ID,
      name: game.i18n.localize("MKSDC.RecipeBooks.WorldRecipesName") || "World Recipes",
      active: true,
      recipes: [],
      recipeCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 2
    };
    await setRecipeBookSetting(books);
  }

  const activeIds = getActiveRecipeBookIds();
  if (!activeIds.length) await setActiveRecipeBookIds([DEFAULT_BOOK_ID]);
  return getRecipeBooks()[DEFAULT_BOOK_ID];
}

export function getEditableRecipeBookId() {
  const books = getRecipeBooks();
  const activeIds = getActiveRecipeBookIds();
  const firstActive = activeIds.find((id) => books[id]);
  return firstActive || Object.keys(books)[0] || DEFAULT_BOOK_ID;
}

export function sanitizeRecipeData(data = {}, options = {}) {
  const recipe = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_RECIPE), data, { inplace: false });
  recipe.id = String(recipe.id || options.id || randomId()).trim();
  recipe.bookId = String(options.bookId || recipe.bookId || DEFAULT_BOOK_ID).trim();
  recipe.enabled = recipe.enabled !== false;
  const legacyGroupType = String(recipe.groupType || recipe.group || "").trim();
  delete recipe.groupType;
  delete recipe.group;
  recipe.craftType = String(recipe.craftType || "basic").trim() || "basic";
  recipe.outputName = String(recipe.outputName || "New Crafted Item").trim() || "New Crafted Item";
  recipe.outputUuid = String(recipe.outputUuid || "").trim();
  recipe.outputType = resolveItemType(recipe.outputType || "Basic", "Basic");
  recipe.category = String(recipe.category || legacyGroupType || recipe.outputType || game.i18n.localize("MKSDC.App.OtherGroup") || "Other").trim() || recipe.outputType || "Other";
  recipe.abilities = normalizeRecipeAbilities(recipe);
  recipe.ability = recipe.abilities[0] || "int";
  recipe.outputImg = String(recipe.outputImg || "icons/svg/item-bag.svg").trim();
  recipe.outputQty = Math.max(1, Number(recipe.outputQty || 1));
  recipe.outputItemData = sanitizeOutputItemData(recipe.outputItemData, recipe);
  recipe.dc = Math.max(1, Number(recipe.dc || 12));
  recipe.time = String(recipe.time || "1 downtime").trim();
  recipe.toolRequired = String(recipe.toolRequired || "").trim();
  recipe.stationRequired = String(recipe.stationRequired || "").trim();
  recipe.goldCost = Math.max(0, Number(recipe.goldCost || 0));
  recipe.failureMode = String(recipe.failureMode || "partial-loss").trim();
  recipe.notes = String(recipe.notes || "").trim();
  recipe.materialGroups = normalizeMaterialGroups(recipe);
  recipe.materials = flattenMaterialGroups(recipe.materialGroups);
  recipe.deconstructEnabled = recipe.deconstructEnabled !== false;
  recipe.deconstructMaterials = normalizeDeconstructMaterials(recipe);
  if (recipe.deconstructEnabled && !recipe.deconstructMaterials.length) {
    recipe.deconstructMaterials = buildDefaultDeconstructMaterials(recipe);
  }
  return recipe;
}

export function getRecipeData(source) {
  if (!source) return sanitizeRecipeData({});

  if (source.documentName === "Item" || source.constructor?.documentName === "Item" || typeof source.getFlag === "function") {
    const raw = foundry.utils.deepClone(source.getFlag?.(MODULE_ID, FLAGS.RECIPE) ?? {});
    const recipe = sanitizeRecipeData(raw, {
      id: source.uuid || source.id || raw.id,
      bookId: source.getFlag?.(MODULE_ID, FLAGS.RECIPE_BOOK_ID) || raw.bookId || DEFAULT_BOOK_ID
    });
    recipe.itemName = source.name ?? recipe.outputName;
    recipe.itemUuid = source.uuid ?? "";
    recipe.img = source.img ?? recipe.outputImg;
    recipe.outputType = resolveItemType(recipe.outputType || source.type || "Basic", "Basic");
    recipe.outputImg = String(recipe.outputImg || source.img || "icons/svg/item-bag.svg").trim();
    return recipe;
  }

  return sanitizeRecipeData(source, { id: source.id, bookId: source.bookId });
}

export function getRecipeEntriesForActor(_actor = null, { activeOnly = true } = {}) {
  const books = getRecipeBooks();
  const activeIds = getActiveRecipeBookIds();
  const entries = [];

  for (const [bookId, book] of Object.entries(books)) {
    if (activeOnly && !activeIds.includes(bookId)) continue;
    const recipes = Array.isArray(book.recipes) ? book.recipes : [];
    for (const rawRecipe of recipes) {
      const recipe = sanitizeRecipeData(rawRecipe, { bookId, id: rawRecipe.id });
      if (!recipe.enabled) continue;
      entries.push({
        id: recipe.id,
        uuid: recipe.id,
        bookId,
        bookName: book.name || bookId,
        name: recipe.outputName,
        img: recipe.outputImg,
        type: recipe.outputType,
        recipe
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRecipeById(recipeId) {
  const id = String(recipeId || "").trim();
  if (!id) return null;

  const books = getRecipeBooks();
  for (const [bookId, book] of Object.entries(books)) {
    const recipe = (book.recipes || []).find((entry) => String(entry.id) === id);
    if (recipe) return sanitizeRecipeData(recipe, { bookId, id: recipe.id });
  }

  // Backward compatibility: if an old UUID is passed, try to resolve it as an item recipe.
  try {
    const item = await fromUuid(id);
    if (item && isRecipeItem(item)) return getRecipeData(item);
  } catch (error) {
    log("Recipe ID lookup failed", id, error);
  }
  return null;
}

export async function upsertRecipe(recipeData, { bookId = null } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  await ensureDefaultRecipeBook();
  const books = getRecipeBooks();
  const targetBookId = String(bookId || recipeData.bookId || getEditableRecipeBookId() || DEFAULT_BOOK_ID).trim();

  if (!books[targetBookId]) {
    books[targetBookId] = {
      id: targetBookId,
      name: targetBookId === DEFAULT_BOOK_ID ? game.i18n.localize("MKSDC.RecipeBooks.WorldRecipesName") : targetBookId,
      active: true,
      recipes: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 2
    };
  }

  const recipe = sanitizeRecipeData(recipeData, { bookId: targetBookId, id: recipeData.id });
  const list = Array.isArray(books[targetBookId].recipes) ? books[targetBookId].recipes : [];
  const index = list.findIndex((entry) => String(entry.id) === String(recipe.id));
  if (index >= 0) list[index] = recipe;
  else list.push(recipe);

  books[targetBookId].recipes = list.sort((a, b) => String(a.outputName || "").localeCompare(String(b.outputName || "")));
  books[targetBookId].recipeCount = books[targetBookId].recipes.length;
  books[targetBookId].updatedAt = nowIso();
  await setRecipeBookSetting(books);
  return recipe;
}

export async function deleteRecipe(recipeId) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return false;
  }

  const id = String(recipeId || "").trim();
  const books = getRecipeBooks();

  for (const [bookId, book] of Object.entries(books)) {
    const list = Array.isArray(book.recipes) ? book.recipes : [];
    const next = list.filter((recipe) => String(recipe.id) !== id);
    if (next.length === list.length) continue;

    book.recipes = next;
    book.recipeCount = next.length;
    book.updatedAt = nowIso();
    books[bookId] = book;
    await setRecipeBookSetting(books);
    ui.notifications.info(game.i18n.localize("MKSDC.Notifications.RecipeDeleted"));
    return true;
  }

  ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RecipeNotFound"));
  return false;
}

export function checkRecipeRequirements(actor, recipe, { resourceActors = null } = {}) {
  const sources = normalizeResourceActors(actor, resourceActors);
  const missing = [];
  const materialGroups = [];
  const materialRows = [];

  for (const group of recipe.materialGroups ?? []) {
    const alternatives = (group.alternatives ?? []).map((material) => {
      const owned = getOwnedMaterialQuantityForActors(sources, material);
      const ownedQty = owned.qty;
      const ok = ownedQty >= material.qty;
      const row = {
        ...material,
        ownedQty,
        missingQty: Math.max(0, material.qty - ownedQty),
        sources: owned.sources,
        sourceSummary: owned.sources.map((source) => `${source.actorName} ${source.qty}`).join(", "),
        ok
      };
      materialRows.push(row);
      return row;
    });

    const selected = alternatives.find((material) => material.ok) ?? alternatives[0] ?? null;
    const ok = alternatives.some((material) => material.ok);
    const groupRow = {
      ...group,
      alternatives,
      selected,
      ok
    };
    materialGroups.push(groupRow);

    if (!ok) {
      missing.push(game.i18n.format("MKSDC.Requirements.MaterialGroupMissing", {
        materials: (group.alternatives ?? []).map((material) => `${material.name} x${material.qty}`).join(` ${game.i18n.localize("MKSDC.App.Or")} `)
      }));
    }
  }

  let toolOk = true;
  if (setting("checkTools") && recipe.toolRequired) {
    toolOk = Boolean(findOwnedItemByNameForActors(sources, recipe.toolRequired));
    if (!toolOk) missing.push(game.i18n.format("MKSDC.Requirements.ToolMissing", { name: recipe.toolRequired }));
  }

  let stationOk = true;
  if (setting("checkStations") && recipe.stationRequired) {
    stationOk = Boolean(findOwnedItemByNameForActors(sources, recipe.stationRequired));
    if (!stationOk) missing.push(game.i18n.format("MKSDC.Requirements.StationMissing", { name: recipe.stationRequired }));
  }

  let goldOk = true;
  let goldInfo = { path: null, amount: 0, sources: [] };
  if (setting("useGoldCost") && recipe.goldCost > 0) {
    goldInfo = getGoldInfoForActors(sources);
    goldOk = Boolean(goldInfo.path) && goldInfo.amount >= recipe.goldCost;
    if (!goldInfo.path) missing.push(game.i18n.localize("MKSDC.Requirements.GoldPathMissing"));
    else if (!goldOk) {
      missing.push(game.i18n.format("MKSDC.Requirements.GoldMissing", {
        need: recipe.goldCost,
        have: goldInfo.amount
      }));
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    materialRows,
    materialGroups,
    toolOk,
    stationOk,
    goldOk,
    goldInfo,
    resourceActors: sources
  };
}

// Legacy compatibility helpers. These keep old macros from crashing, but new recipes are not Items.
export async function getRecipeByUuid(uuid) {
  return getRecipeById(uuid);
}

export async function getRecipeItemsForActor(actor) {
  return getRecipeEntriesForActor(actor);
}

export async function setRecipeData(item, recipeData) {
  if (item?.setFlag) {
    const recipe = sanitizeRecipeData(recipeData);
    await item.setFlag(MODULE_ID, FLAGS.IS_RECIPE, true);
    await item.setFlag(MODULE_ID, FLAGS.RECIPE, recipe);
    return item;
  }
  return upsertRecipe(recipeData);
}

export async function createRecipeItem(recipeData, _itemData = {}) {
  return upsertRecipe(recipeData);
}

export async function deleteRecipeItem(itemOrId) {
  if (typeof itemOrId === "string") return deleteRecipe(itemOrId);
  if (itemOrId?.id && !(itemOrId?.delete)) return deleteRecipe(itemOrId.id);

  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return false;
  }

  if (!itemOrId || !isRecipeItem(itemOrId)) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RecipeNotFound"));
    return false;
  }

  if (itemOrId.pack) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.CompendiumRecipeReadOnly"));
    return false;
  }

  await itemOrId.delete();
  ui.notifications.info(game.i18n.localize("MKSDC.Notifications.RecipeDeleted"));
  return true;
}

export async function createSampleRecipes() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return [];
  }

  await ensureDefaultRecipeBook();
  const samples = [
    {
      craftType: "survival",
      outputName: "Bone Knife",
      outputType: "Weapon",
      category: "Survival",
      outputImg: "icons/svg/item-bag.svg",
      outputQty: 1,
      dc: 9,
      abilities: ["wis", "dex"],
      time: "1 hour",
      materials: [
        { name: "Bone Shards", qty: 2 },
        { name: "Leather Straps", qty: 1 }
      ],
      notes: "A simple camp-made knife."
    },
    {
      craftType: "armor",
      outputName: "Chitin Shield",
      outputType: "Armor",
      category: "Armor",
      outputImg: "icons/svg/item-bag.svg",
      outputQty: 1,
      dc: 12,
      abilities: ["int", "str"],
      time: "1 downtime",
      toolRequired: "Crafting Tools",
      materials: [
        { name: "Chitin Plates", qty: 3 },
        { name: "Leather Straps", qty: 2 }
      ],
      notes: "A light shield made from hardened shell."
    },
    {
      craftType: "alchemy",
      outputName: "Crystal Salve",
      outputType: "Basic",
      category: "Alchemy",
      outputImg: "icons/svg/item-bag.svg",
      outputQty: 1,
      dc: 15,
      abilities: ["int"],
      time: "1 downtime",
      toolRequired: "Alchemist Tools",
      materials: [
        { name: "Crystal Dust", qty: 1 },
        { name: "Rare Herbs", qty: 2 }
      ],
      notes: "A strange salve suitable for harsh wasteland campaigns."
    }
  ];

  const created = [];
  const existingNames = new Set(getRecipeEntriesForActor(null, { activeOnly: false }).map((entry) => entry.name));
  for (const sample of samples) {
    if (existingNames.has(sample.outputName)) continue;
    created.push(await upsertRecipe(sample, { bookId: DEFAULT_BOOK_ID }));
  }

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.SampleRecipesCreated", { count: created.length }));
  return created;
}
