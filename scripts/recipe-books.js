import { DEFAULT_BOOK_ID, MODULE_ID, TEMPLATES } from "./constants.js";
import { createRecipeId, getActiveRecipeBookIds, getRecipeBooks, getRecipeData, getRecipeEntriesForActor, isRecipeItem, mutateRecipeBooks, sanitizeRecipeData, setActiveRecipeBookIds } from "./recipe-utils.js";

const BOOK_KIND = "mk-shadowdark-crafting.recipe-book";
const BOOK_SCHEMA_VERSION = 2;
const CURRENT_ACTIVE_KEY = "__current_active__";

function slugify(value) {
  return String(value || "recipe-book")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "recipe-book";
}

function randomId(prefix = "book") {
  const id = foundry.utils.randomID?.(12) || crypto.randomUUID?.() || `${Date.now()}${Math.floor(Math.random() * 9999)}`;
  return `${prefix}-${id}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeBookName(name) {
  return String(name || game.i18n.localize("MKSDC.RecipeBooks.DefaultName")).trim() || game.i18n.localize("MKSDC.RecipeBooks.DefaultName");
}

function normalizeBook(raw = {}, fallback = {}) {
  const id = String(raw.id || fallback.id || randomId()).trim();
  const recipes = (Array.isArray(raw.recipes) ? raw.recipes : [])
    .map((recipe) => sanitizeRecipeData(recipe, { bookId: id, id: recipe.id }))
    .sort((a, b) => a.outputName.localeCompare(b.outputName));

  return {
    kind: BOOK_KIND,
    schemaVersion: BOOK_SCHEMA_VERSION,
    id,
    name: sanitizeBookName(raw.name || fallback.name),
    active: Boolean(raw.active ?? fallback.active ?? false),
    recipes,
    recipeCount: recipes.length,
    createdAt: raw.createdAt || raw.savedAt || nowIso(),
    savedAt: raw.savedAt || raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
    worldId: raw.worldId || game.world?.id || "",
    systemId: raw.systemId || game.system?.id || "shadowdark",
    systemVersion: raw.systemVersion || game.system?.version || "",
    moduleVersion: game.modules?.get(MODULE_ID)?.version || ""
  };
}

function normalizeBooksInPlace(books) {
  for (const [id, book] of Object.entries(books || {})) {
    books[id] = normalizeBook({ ...book, id });
  }
  return books;
}

async function mutateBooks(mutator) {
  const mutation = await mutateRecipeBooks(async (books) => {
    const result = await mutator(books);
    if (result?.cancel === true) return result;
    normalizeBooksInPlace(books);
    return result;
  });

  if (mutation.changed) {
    const activeIds = Object.entries(mutation.books)
      .filter(([, book]) => Boolean(book?.active))
      .map(([id]) => id);
    await setActiveRecipeBookIds(activeIds);
  }

  return mutation;
}

export function getSavedRecipeBooks() {
  return getRecipeBooks();
}

function getLegacyRecipeItems() {
  return Array.from(game.items ?? [])
    .filter((item) => isRecipeItem(item) && !item.pack)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getActiveRecipes() {
  return getRecipeEntriesForActor(null, { activeOnly: true }).map((entry) => entry.recipe);
}

export async function buildRecipeBookData({ name = null, recipes = null, active = false, id = null } = {}) {
  const bookId = String(id || randomId()).trim();
  const sourceRecipes = Array.isArray(recipes) ? recipes : getActiveRecipes();
  return normalizeBook({
    id: bookId,
    name: sanitizeBookName(name || game.i18n.localize("MKSDC.RecipeBooks.DefaultName")),
    active,
    recipes: sourceRecipes.map((recipe) => ({ ...recipe, bookId }))
  });
}

export async function saveRecipeBook(name = null) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const book = await buildRecipeBookData({ name, active: false });
  await mutateBooks((books) => {
    books[book.id] = book;
  });
  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookSaved", { name: book.name, count: book.recipeCount }));
  return book;
}

export function exportRecipeBook(book) {
  if (!book) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));
    return false;
  }

  const data = normalizeBook(book);
  const filename = `${slugify(data.name)}.json`;
  saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
  return true;
}

export async function importRecipeBookData(data, { mode = "create", activate = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const raw = typeof data === "string" ? JSON.parse(data) : foundry.utils.deepClone(data);
  const incomingBase = raw?.kind === BOOK_KIND || Array.isArray(raw?.recipes)
    ? raw
    : { name: raw?.name || game.i18n.localize("MKSDC.RecipeBooks.ImportedName"), recipes: [] };

  const baseId = String(incomingBase.id || slugify(incomingBase.name) || DEFAULT_BOOK_ID).trim();
  const id = mode === "merge"
    ? baseId
    : `${slugify(incomingBase.name || "imported-book")}-${foundry.utils.randomID?.(6) || Date.now()}`;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let book = null;

  await mutateBooks((books) => {
    if (mode === "merge") {
      const existing = books[id] ?? null;
      const nextRecipes = Array.isArray(existing?.recipes)
        ? existing.recipes.map((recipe) => sanitizeRecipeData(recipe, { bookId: id, id: recipe.id }))
        : [];
      const indexById = new Map(nextRecipes.map((recipe, index) => [String(recipe.id), index]));

      for (const incomingRecipe of incomingBase.recipes || []) {
        if (!incomingRecipe) {
          skipped += 1;
          continue;
        }

        const recipe = sanitizeRecipeData(incomingRecipe, { bookId: id, id: incomingRecipe.id || createRecipeId() });
        const existingIndex = indexById.get(String(recipe.id));
        if (existingIndex === undefined) {
          nextRecipes.push(recipe);
          indexById.set(String(recipe.id), nextRecipes.length - 1);
          created += 1;
        } else {
          nextRecipes[existingIndex] = recipe;
          updated += 1;
        }
      }

      book = normalizeBook({
        ...incomingBase,
        ...(existing || {}),
        id,
        name: incomingBase.name || existing?.name || game.i18n.localize("MKSDC.RecipeBooks.ImportedName"),
        active: activate || Boolean(existing?.active),
        recipes: nextRecipes,
        createdAt: existing?.createdAt || incomingBase.createdAt,
        updatedAt: nowIso()
      }, { name: game.i18n.localize("MKSDC.RecipeBooks.ImportedName") });
    } else {
      book = normalizeBook({
        ...incomingBase,
        id,
        active: activate,
        recipes: (incomingBase.recipes || []).filter(Boolean).map((recipe) => ({ ...recipe, id: undefined, bookId: id }))
      }, { name: game.i18n.localize("MKSDC.RecipeBooks.ImportedName") });
      created = book.recipeCount;
    }

    books[id] = book;
  });

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookImported", {
    name: book.name,
    created,
    updated,
    skipped
  }));
  return { book, created, updated, skipped };
}

export async function renameSavedRecipeBook(bookId, name) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const id = String(bookId || "").trim();
  let renamed = null;
  await mutateBooks((books) => {
    const book = books[id];
    if (!book) return { cancel: true };
    book.name = sanitizeBookName(name);
    book.updatedAt = nowIso();
    renamed = normalizeBook(book);
    books[id] = renamed;
  });

  if (!renamed) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));
    return null;
  }

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookRenamed", { name: renamed.name }));
  return renamed;
}

export async function deleteSavedRecipeBook(bookId) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return false;
  }

  const id = String(bookId || "").trim();
  let deletedBook = null;
  await mutateBooks((books) => {
    if (!books[id]) return { cancel: true };
    deletedBook = books[id];
    delete books[id];
  });

  if (!deletedBook) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));
    return false;
  }

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookDeleted", { name: deletedBook.name || id }));
  return true;
}

export async function updateSavedRecipeBookFromWorld(bookId) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const id = String(bookId || "").trim();
  const activeRecipes = getRecipeEntriesForActor(null, { activeOnly: true })
    .filter((entry) => entry.bookId === id)
    .map((entry) => entry.recipe);
  let updatedBook = null;

  await mutateBooks((books) => {
    const existing = books[id];
    if (!existing) return { cancel: true };
    const sourceRecipes = activeRecipes.length ? activeRecipes : (Array.isArray(existing.recipes) ? existing.recipes : []);

    updatedBook = normalizeBook({
      ...existing,
      recipes: sourceRecipes.map((recipe) => ({ ...recipe, bookId: id })),
      updatedAt: nowIso()
    });
    books[id] = updatedBook;
  });

  if (!updatedBook) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));
    return null;
  }

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookUpdated", { name: updatedBook.name, count: updatedBook.recipeCount }));
  return updatedBook;
}

async function setBookActive(bookId, active) {
  const id = String(bookId || "").trim();
  let changed = false;
  await mutateBooks((books) => {
    if (!books[id]) return { cancel: true };
    books[id].active = Boolean(active);
    books[id].updatedAt = nowIso();
    changed = true;
  });
  return changed;
}

async function migrateLegacyItemsToBook({ deleteItems = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const items = getLegacyRecipeItems();
  if (!items.length) {
    ui.notifications.info(game.i18n.localize("MKSDC.Notifications.NoLegacyRecipes"));
    return null;
  }

  const id = `migrated-world-recipes-${foundry.utils.randomID?.(6) || Date.now()}`;
  const book = normalizeBook({
    id,
    name: game.i18n.localize("MKSDC.RecipeBooks.MigratedWorldRecipes"),
    active: true,
    recipes: items.map((item) => ({ ...getRecipeData(item), id: undefined, bookId: id }))
  });

  await mutateBooks((books) => {
    books[id] = book;
  });

  if (deleteItems) await Item.deleteDocuments(items.map((item) => item.id));

  ui.notifications.info(game.i18n.format("MKSDC.Notifications.LegacyRecipesMigrated", { count: book.recipeCount, name: book.name }));
  return book;
}

async function openApplySavedRecipeBookDialog(book) {
  if (!book) return ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));
  await setBookActive(book.id, true);
  ui.notifications.info(game.i18n.format("MKSDC.Notifications.RecipeBookActivated", { name: book.name }));
  return book;
}

async function promptRenameSavedRecipeBook(bookId) {
  const books = getSavedRecipeBooks();
  const book = books[String(bookId || "")];
  if (!book) return ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.InvalidRecipeBook"));

  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("MKSDC.RecipeBooks.RenameTitle"),
      content: `
        <form class="mk-sdc mk-sdc-book-dialog">
          <div class="form-group">
            <label>${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.BookName"))}</label>
            <input type="text" name="bookName" value="${escapeHtml(book.name || "")}">
          </div>
        </form>`,
      buttons: {
        rename: {
          icon: '<i class="fas fa-i-cursor"></i>',
          label: game.i18n.localize("MKSDC.Buttons.Rename"),
          callback: async (html) => resolve(await renameSavedRecipeBook(bookId, html.find("[name='bookName']").val()))
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("MKSDC.Buttons.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "rename",
      close: () => resolve(null)
    }).render(true);
  });
}

export class RecipeBookManager extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mk-shadowdark-recipe-book-manager",
      classes: ["mk-sdc", "mk-sdc-book-manager"],
      title: game.i18n.localize("MKSDC.RecipeBooks.ManagerTitle"),
      template: TEMPLATES.RECIPE_BOOK_MANAGER,
      width: 760,
      height: "auto",
      resizable: true
    });
  }

  async getData() {
    const savedBooks = getSavedRecipeBooks();
    const activeIds = getActiveRecipeBookIds();
    const books = Object.entries(savedBooks)
      .map(([id, book]) => ({
        id,
        name: book.name || id,
        count: Number(book.recipeCount || book.recipes?.length || 0),
        active: activeIds.includes(id) || Boolean(book.active),
        savedAt: book.savedAt || book.createdAt || "",
        updatedAt: book.updatedAt || "",
        systemVersion: book.systemVersion || "",
        moduleVersion: book.moduleVersion || ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      books,
      hasBooks: books.length > 0,
      currentWorldCount: getActiveRecipes().length,
      legacyItemCount: getLegacyRecipeItems().length,
      hasLegacyItems: getLegacyRecipeItems().length > 0,
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='save-current']").on("click", async (event) => {
      event.preventDefault();
      await openSaveRecipeBookDialog();
      this.render(false);
    });

    html.find("[data-action='export-book-dialog']").on("click", async (event) => {
      event.preventDefault();
      await openExportRecipeBookDialog();
    });

    html.find("[data-action='import-file']").on("click", async (event) => {
      event.preventDefault();
      await openImportRecipeBookDialog();
      this.render(false);
    });

    html.find("[data-action='migrate-legacy']").on("click", async (event) => {
      event.preventDefault();
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("MKSDC.RecipeBooks.MigrateTitle"),
        content: `<p>${game.i18n.localize("MKSDC.RecipeBooks.MigrateContent")}</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: true
      });
      if (!confirmed) return;
      await migrateLegacyItemsToBook({ deleteItems: false });
      this.render(false);
    });

    html.find("[data-action='toggle-active']").on("change", async (event) => {
      await setBookActive(event.currentTarget.dataset.bookId, event.currentTarget.checked);
      this.render(false);
    });

    html.find("[data-action='rename-book']").on("click", async (event) => {
      event.preventDefault();
      await promptRenameSavedRecipeBook(event.currentTarget.dataset.bookId);
      this.render(false);
    });

    html.find("[data-action='export-book']").on("click", (event) => {
      event.preventDefault();
      const book = getSavedRecipeBooks()[event.currentTarget.dataset.bookId];
      exportRecipeBook(book);
    });

    html.find("[data-action='apply-book']").on("click", async (event) => {
      event.preventDefault();
      const book = getSavedRecipeBooks()[event.currentTarget.dataset.bookId];
      await openApplySavedRecipeBookDialog(book);
      this.render(false);
    });

    html.find("[data-action='update-book']").on("click", async (event) => {
      event.preventDefault();
      const book = getSavedRecipeBooks()[event.currentTarget.dataset.bookId];
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("MKSDC.RecipeBooks.UpdateTitle"),
        content: `<p>${game.i18n.format("MKSDC.RecipeBooks.UpdateContent", { name: escapeHtml(book?.name || "") })}</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
      if (!confirmed) return;
      await updateSavedRecipeBookFromWorld(event.currentTarget.dataset.bookId);
      this.render(false);
    });

    html.find("[data-action='delete-book']").on("click", async (event) => {
      event.preventDefault();
      const bookId = event.currentTarget.dataset.bookId;
      const book = getSavedRecipeBooks()[bookId];
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("MKSDC.RecipeBooks.DeleteTitle"),
        content: `<p>${game.i18n.format("MKSDC.RecipeBooks.DeleteContent", { name: escapeHtml(book?.name || "") })}</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
      if (!confirmed) return;
      await deleteSavedRecipeBook(bookId);
      this.render(false);
    });
  }
}

export function openManageRecipeBooks() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const app = new RecipeBookManager();
  app.render(true);
  return app;
}

export async function openSaveRecipeBookDialog() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const defaultName = `${game.world?.title || game.world?.id || "Shadowdark"} ${game.i18n.localize("MKSDC.RecipeBooks.DefaultName")}`;
  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("MKSDC.RecipeBooks.SaveTitle"),
      content: `
        <form class="mk-sdc mk-sdc-book-dialog">
          <div class="form-group">
            <label>${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.BookName"))}</label>
            <input type="text" name="bookName" value="${escapeHtml(defaultName)}">
          </div>
          <p class="hint">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.SaveHint"))}</p>
        </form>`,
      buttons: {
        save: {
          icon: '<i class="fas fa-book-bookmark"></i>',
          label: game.i18n.localize("MKSDC.Buttons.SaveBook"),
          callback: async (html) => resolve(await saveRecipeBook(html.find("[name='bookName']").val()))
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("MKSDC.Buttons.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "save",
      close: () => resolve(null)
    }).render(true);
  });
}

export async function openExportRecipeBookDialog() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  const books = getSavedRecipeBooks();
  const savedOptions = Object.entries(books)
    .sort(([, a], [, b]) => String(a.name || "").localeCompare(String(b.name || "")))
    .map(([id, book]) => `<option value="${escapeHtml(id)}">${escapeHtml(book.name || id)} (${Number(book.recipeCount || book.recipes?.length || 0)})</option>`)
    .join("");

  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("MKSDC.RecipeBooks.ExportTitle"),
      content: `
        <form class="mk-sdc mk-sdc-book-dialog">
          <div class="form-group">
            <label>${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.BookToExport"))}</label>
            <select name="bookId">
              <option value="${CURRENT_ACTIVE_KEY}">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.CurrentWorldRecipes"))}</option>
              ${savedOptions}
            </select>
          </div>
          <p class="hint">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.ExportHint"))}</p>
        </form>`,
      buttons: {
        export: {
          icon: '<i class="fas fa-file-export"></i>',
          label: game.i18n.localize("MKSDC.Buttons.ExportBook"),
          callback: async (html) => {
            const bookId = html.find("[name='bookId']").val();
            const book = bookId === CURRENT_ACTIVE_KEY
              ? await buildRecipeBookData({ name: game.i18n.localize("MKSDC.RecipeBooks.CurrentWorldRecipes") })
              : books[bookId];
            resolve(exportRecipeBook(book));
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("MKSDC.Buttons.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "export",
      close: () => resolve(null)
    }).render(true);
  });
}

export async function openImportRecipeBookDialog() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.GMOnly"));
    return null;
  }

  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("MKSDC.RecipeBooks.ImportTitle"),
      content: `
        <form class="mk-sdc mk-sdc-book-dialog">
          <div class="form-group">
            <label>${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.File"))}</label>
            <input type="file" name="file" accept="application/json,.json">
          </div>
          <div class="form-group">
            <label>${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.ImportMode"))}</label>
            <select name="mode">
              <option value="create">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.ImportModeCreate"))}</option>
              <option value="merge">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.ImportModeMerge"))}</option>
            </select>
          </div>
          <p class="hint">${escapeHtml(game.i18n.localize("MKSDC.RecipeBooks.ImportHint"))}</p>
        </form>`,
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: game.i18n.localize("MKSDC.Buttons.ImportBook"),
          callback: async (html) => {
            const file = html.find("[name='file']")[0]?.files?.[0];
            const mode = html.find("[name='mode']").val() || "create";
            if (!file) {
              ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoImportFile"));
              resolve(null);
              return;
            }

            const text = await file.text();
            try {
              const json = JSON.parse(text);
              resolve(await importRecipeBookData(json, { mode, activate: true }));
            } catch (error) {
              console.error(`${MODULE_ID} | Recipe book import failed`, error);
              ui.notifications.error(game.i18n.localize("MKSDC.Notifications.RecipeBookImportFailed"));
              resolve(null);
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("MKSDC.Buttons.Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "import",
      close: () => resolve(null)
    }).render(true);
  });
}
