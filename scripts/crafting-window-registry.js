export function getCraftingWindowActorKey(actor) {
  return String(actor?.uuid || actor?.id || "").trim();
}

export class CraftingWindowRegistry {
  constructor() {
    this.entries = new Map();
  }

  get(actor) {
    const key = getCraftingWindowActorKey(actor);
    if (!key) return null;
    const entry = this.entries.get(key) ?? null;
    if (!entry) return null;

    if (!entry.renderPromise && !entry.app?.rendered) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  track(actor, app) {
    const key = getCraftingWindowActorKey(actor);
    if (!key || !app) return null;
    const entry = { app, renderPromise: null };
    this.entries.set(key, entry);
    return entry;
  }

  setRenderPromise(actor, app, renderPromise) {
    const key = getCraftingWindowActorKey(actor);
    const entry = key ? this.entries.get(key) : null;
    if (!entry || entry.app !== app) return false;
    entry.renderPromise = renderPromise ?? null;
    return true;
  }

  clearRenderPromise(actor, app) {
    return this.setRenderPromise(actor, app, null);
  }

  remove(actor, app = null) {
    const key = getCraftingWindowActorKey(actor);
    const entry = key ? this.entries.get(key) : null;
    if (!entry || (app && entry.app !== app)) return false;
    this.entries.delete(key);
    return true;
  }

  prune() {
    for (const [key, entry] of this.entries) {
      if (!entry.renderPromise && !entry.app?.rendered) this.entries.delete(key);
    }
  }
}
