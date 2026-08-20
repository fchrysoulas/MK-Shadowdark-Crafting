const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Thin ApplicationV2 base used while the module migrates from ApplicationV1.
 *
 * Subclasses can keep their existing getData/activateListeners methods during
 * the transition. Rendering and form submission are handled by ApplicationV2,
 * while _onRender adapts the rendered root to the existing jQuery listeners.
 */
export class MKApplicationV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = typeof this.getData === "function" ? await this.getData(options) : {};
    return { ...context, ...(data || {}) };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (typeof this.activateListeners !== "function") return;
    const html = globalThis.jQuery ? globalThis.jQuery(this.element) : globalThis.$?.(this.element);
    if (html) this.activateListeners(html);
  }

  // Compatibility hook for existing subclasses. ApplicationV2 itself does not
  // provide the ApplicationV1 activateListeners lifecycle method.
  activateListeners(_html) {}
}

async function legacyFormHandler(_event, form, formData) {
  if (typeof this._updateObject !== "function") return;
  const flat = Object.fromEntries(formData.entries());
  return this._updateObject({ currentTarget: form }, flat);
}

/**
 * ApplicationV2 form base. The root application element is the form, and
 * submission is routed through the modern ApplicationV2 form handler.
 */
export class MKFormApplicationV2 extends MKApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    form: {
      closeOnSubmit: true,
      handler: legacyFormHandler
    }
  };
}

export { DialogV2 };

export async function confirmDialog({ title, content, defaultYes = false } = {}) {
  return Boolean(await DialogV2.confirm({
    window: { title: String(title || "") },
    content: String(content || ""),
    modal: true,
    rejectClose: false,
    yes: { default: Boolean(defaultYes) },
    no: { default: !defaultYes }
  }));
}

export function dialogValue(button, name, fallback = "") {
  return button?.form?.elements?.[name]?.value ?? fallback;
}

export function dialogFile(button, name) {
  return button?.form?.elements?.[name]?.files?.[0] ?? null;
}
