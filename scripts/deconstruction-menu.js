import {
  canDeconstructItem,
  deconstructItem,
  findOwnedDeconstructableItem,
  getOwnedItemFromContextElement,
  hasDeconstructionRecipeForItem
} from "./deconstruction-engine.js";

const ITEM_CONTEXT_SELECTOR = [
  "[data-item-id]",
  "[data-item-uuid]",
  "[data-document-id]",
  "[data-document-uuid]",
  "[data-entry-id]",
  "[data-entity-id]",
  "[data-id]",
  "[data-uuid]",
  ".item",
  ".directory-item",
  ".document"
].join(", ");

function asHtmlElement(target) {
  return target?.[0] ?? target?.currentTarget ?? target ?? null;
}

function getActorFromSheet(app) {
  return app?.actor ?? app?.document ?? null;
}

function getSelectedActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const tokenActor = controlled[0]?.actor;
  if (tokenActor) return tokenActor;
  return game.user?.character ?? null;
}

function getNativeContextMenuClass() {
  return globalThis.ContextMenu ?? foundry?.applications?.ux?.ContextMenu ?? null;
}

function getDocumentIdFromElement(element) {
  let node = element instanceof HTMLElement ? element : null;
  while (node) {
    const dataset = node.dataset ?? {};
    const id = dataset.itemId || dataset.documentId || dataset.entryId || dataset.entityId || dataset.id;
    if (id) return String(id).trim();
    node = node.parentElement;
  }
  return "";
}

function getDocumentUuidFromElement(element) {
  let node = element instanceof HTMLElement ? element : null;
  while (node) {
    const dataset = node.dataset ?? {};
    const uuid = dataset.itemUuid || dataset.documentUuid || dataset.uuid;
    if (uuid) return String(uuid).trim();
    node = node.parentElement;
  }
  return "";
}

function getItemFromDirectoryTarget(target) {
  const element = asHtmlElement(target);
  if (!(element instanceof HTMLElement)) return null;

  const uuid = getDocumentUuidFromElement(element);
  if (uuid) {
    try {
      const document = typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null;
      if (document?.documentName === "Item") return document;
    } catch (_error) {
      // Fall through to the id lookup below.
    }
  }

  const id = getDocumentIdFromElement(element);
  if (!id) return null;

  return game.items?.get?.(id) ?? null;
}

async function deconstructDirectoryItem(target, app = null) {
  const referenceItem = getItemFromDirectoryTarget(target);
  if (!referenceItem) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Deconstruct.NoItem"));
    return null;
  }

  const actor = getSelectedActor();
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
    return null;
  }

  const ownedItem = findOwnedDeconstructableItem(actor, referenceItem);
  if (!ownedItem) {
    ui.notifications.warn(game.i18n.format("MKSDC.Deconstruct.NoOwnedItem", { actor: actor.name || "", item: referenceItem.name || "" }));
    return null;
  }

  const result = await deconstructItem(actor, ownedItem);
  app?.render?.(false);
  return result;
}

function getActorMenuItems(app, actor) {
  return [
    {
      name: game.i18n.localize("MKSDC.Deconstruct.Action"),
      icon: '<i class="fas fa-recycle"></i>',
      condition: (target) => canDeconstructItem(getOwnedItemFromContextElement(actor, target)),
      callback: async (target) => {
        const item = getOwnedItemFromContextElement(actor, target);
        await deconstructItem(actor, item);
        app?.render?.(false);
      }
    }
  ];
}

function getDirectoryMenuItem(app = null) {
  return {
    name: game.i18n.localize("MKSDC.Deconstruct.Action"),
    icon: '<i class="fas fa-recycle"></i>',
    condition: (target) => hasDeconstructionRecipeForItem(getItemFromDirectoryTarget(target)),
    callback: async (target) => deconstructDirectoryItem(target, app)
  };
}

function installFallbackContextHandler(app, html, actor) {
  const root = html?.[0] ?? html;
  if (!(root instanceof HTMLElement)) return;

  root.addEventListener("contextmenu", async (event) => {
    const target = event.target?.closest?.(ITEM_CONTEXT_SELECTOR);
    if (!target || !root.contains(target)) return;

    const item = getOwnedItemFromContextElement(actor, target);
    if (!canDeconstructItem(item)) return;

    event.preventDefault();
    await deconstructItem(actor, item);
    app?.render?.(false);
  });
}

function createNativeContextMenu(app, html, selector, menuItems) {
  const ContextMenuClass = getNativeContextMenuClass();
  if (!ContextMenuClass) return false;

  if (typeof ContextMenuClass.create === "function") {
    try {
      ContextMenuClass.create(app, html, selector, menuItems);
      return true;
    } catch (_error) {
      // Try the older constructor signature below.
    }
  }

  try {
    new ContextMenuClass(html, selector, menuItems);
    return true;
  } catch (error) {
    console.warn("mk-shadowdark-crafting | Native ContextMenu registration failed; using fallback.", error);
    return false;
  }
}

export function registerActorItemDeconstructionContext(app, html) {
  const actor = getActorFromSheet(app);
  if (!actor?.items) return;

  const menuItems = getActorMenuItems(app, actor);
  if (createNativeContextMenu(app, html, ITEM_CONTEXT_SELECTOR, menuItems)) return;

  installFallbackContextHandler(app, html, actor);
}

export function registerItemDirectoryDeconstructionContext(_html, entryOptions) {
  if (!Array.isArray(entryOptions)) return;

  const alreadyRegistered = entryOptions.some((option) => option?.name === game.i18n.localize("MKSDC.Deconstruct.Action"));
  if (alreadyRegistered) return;

  entryOptions.push(getDirectoryMenuItem(ui?.items));
}
