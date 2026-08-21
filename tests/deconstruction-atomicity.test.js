import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "mk-shadowdark-crafting";

function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
  return true;
}

let idCounter = 0;
class ApplicationV2 {}
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: async () => true, wait: async () => null }
    }
  },
  utils: {
    deepClone,
    getProperty,
    setProperty,
    mergeObject: (original, other) => ({ ...deepClone(original || {}), ...deepClone(other || {}) }),
    randomID: () => `test-${++idCounter}`
  }
};

const settings = {
  allowPlayerCrafting: true,
  recipeItemType: "Basic",
  recipeBooks: {},
  activeRecipeBookIds: [],
  operationLockState: {},
  debug: false
};
const currentUser = { id: "gm-1", isGM: true, active: true };
globalThis.game = {
  user: currentUser,
  users: [currentUser],
  system: { id: "shadowdark", documentTypes: { Item: ["Basic"] } },
  settings: {
    get: (_moduleId, key) => settings[key],
    set: async (_moduleId, key, value) => {
      settings[key] = deepClone(value);
      return value;
    }
  },
  socket: { on() {}, emit() {} },
  i18n: {
    lang: "en",
    localize: (key) => key,
    format: (key, data = {}) => `${key}:${JSON.stringify(data)}`
  }
};
globalThis.CONFIG = { queries: {} };
globalThis.canvas = { tokens: { placeables: [] }, scene: { tokens: [] } };
globalThis.fromUuid = async () => null;
globalThis.renderTemplate = async () => "<p>deconstruction result</p>";
globalThis.ChatMessage = {
  getSpeaker: () => ({ alias: "Crafter" }),
  create: async () => ({ id: "chat-1" })
};
const warnings = [];
globalThis.ui = {
  notifications: {
    warn: (message) => warnings.push(message),
    info() {},
    error() {}
  }
};

function makeItem(source, actor) {
  const flags = deepClone(source.flags || {});
  return {
    id: source._id,
    name: source.name,
    type: source.type || "Basic",
    img: source.img || "icons/svg/item-bag.svg",
    uuid: `Actor.${actor.id}.Item.${source._id}`,
    parent: actor,
    system: deepClone(source.system || { quantity: 1 }),
    _stats: {},
    getFlag(scope, key) {
      return flags?.[scope]?.[key] ?? null;
    },
    async setFlag(scope, key, value) {
      flags[scope] ??= {};
      flags[scope][key] = deepClone(value);
      return value;
    },
    async unsetFlag(scope, key) {
      if (flags[scope]) delete flags[scope][key];
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setProperty(this, path, value);
    },
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        system: deepClone(this.system),
        flags: deepClone(flags)
      };
    }
  };
}

function makeActor() {
  const items = [];
  items.get = (id) => items.find((item) => item.id === id) ?? null;
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Crafter",
    type: "character",
    documentName: "Actor",
    isOwner: true,
    items,
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = items.findIndex((item) => item.id === id);
        if (index >= 0) items.splice(index, 1);
      }
    },
    async createEmbeddedDocuments(_type, sources) {
      if (sources.some((source) => source.name === "Wood")) {
        throw new Error("simulated refund creation failure");
      }
      const created = sources.map((source) => makeItem({ ...source, _id: source._id || `created-${++idCounter}` }, actor));
      items.push(...created);
      return created;
    }
  };

  const recipeSnapshot = {
    id: "blade-recipe",
    bookId: "active-book",
    enabled: true,
    outputName: "Iron Blade",
    outputType: "Basic",
    outputQty: 1,
    materialGroups: [],
    deconstructEnabled: true,
    deconstructGenerated: false,
    deconstructMaterials: [
      { name: "Iron", type: "Basic", qty: 1 },
      { name: "Wood", type: "Basic", qty: 1 }
    ]
  };
  const crafted = makeItem({
    _id: "crafted-blade",
    name: "Iron Blade",
    type: "Basic",
    system: { quantity: 1 },
    flags: {
      [MODULE_ID]: {
        crafted: {
          recipeId: recipeSnapshot.id,
          recipeBookId: recipeSnapshot.bookId,
          recipeSnapshot
        }
      }
    }
  }, actor);
  const iron = makeItem({
    _id: "iron",
    name: "Iron",
    type: "Basic",
    system: { quantity: 5 }
  }, actor);
  items.push(crafted, iron);
  return { actor, crafted, iron };
}

const { deconstructItem } = await import("../scripts/deconstruction-engine.js");

test("refund mutation failure restores the source item and earlier refunds", { concurrency: false }, async () => {
  const { actor, crafted, iron } = makeActor();
  warnings.length = 0;

  const result = await deconstructItem(actor, crafted, { skipConfirm: true });

  assert.equal(result, null);
  assert.equal(actor.items.get("crafted-blade")?.system.quantity, 1);
  assert.ok(actor.items.get("crafted-blade")?.getFlag(MODULE_ID, "crafted"));
  assert.equal(iron.system.quantity, 5);
  assert.equal(actor.items.some((item) => item.name === "Wood"), false);
  assert.deepEqual(warnings, ["MKSDC.Deconstruct.CouldNotRemoveItem"]);
});
