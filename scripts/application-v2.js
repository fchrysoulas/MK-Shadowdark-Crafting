const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Shared ApplicationV2 base for the module's Handlebars applications.
 * Subclasses may keep their existing getData method while using the modern
 * ApplicationV2 context, parts, actions, and render lifecycle.
 */
export class MKApplicationV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = typeof this.getData === "function" ? await this.getData(options) : {};
    return { ...context, ...(data || {}) };
  }
}

async function applicationFormHandler(_event, form, formData) {
  if (typeof this._updateObject !== "function") return;
  const flat = Object.fromEntries(formData.entries());
  return this._updateObject({ currentTarget: form }, flat);
}

/**
 * ApplicationV2 form base. The application root owns the form and submission
 * is routed through the native ApplicationV2 form handler.
 */
export class MKFormApplicationV2 extends MKApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    form: {
      closeOnSubmit: true,
      handler: applicationFormHandler
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
