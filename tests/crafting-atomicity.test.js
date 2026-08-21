import test from "node:test";
import assert from "node:assert/strict";

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
const DialogV2 = {
  wait: async () => ({ ability: "int", rollMode: "normal" }),
  confirm: async () => true
};

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2
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

const recipe = {
  id: "atomic-craft",
  bookId: "active-book",
  enabled: true,
  outputName: "Iron Blade",
  outputType: "Basic",
  outputQty: 1,
  outputSourceMode: "snapshot",
  outputItemData: { name: "Iron Blade", type: "Basic", system: { quantity: 1 } },
  dc: 10,
  abilities: ["int"],
  materialGroups: [{ alternatives: [{ name: "Iron", type: "Basic", qty: 2 }] }],
  goldCost: 3,
  deconstructEnabled: true,
  deconstructGenerated: true
};

const settings = {
  allowPlayerCrafting: true,
  consumeMaterialsOnFailure: true,
  criticalFailureLosesAll: true,
  criticalSuccessHalfCost: false,
  useGoldCost: true,
  checkTools: false,
  checkStations: false,
  recipeItemType: "Basic",
  debug: false,
  operationLockState: {},
  activeRecipeBookIds: ["active-book"],
  recipeBooks: {
    "active-book": {
      id: "active-book",
      active: true,
      recipes: [recipe]
    }
  }
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
const errors = [];
globalThis.ui = {
  notifications: {
    warn() {},
    info() {},
    error: (message) => errors.push(message)
  }
};
globalThis.fromUuid = async () => null;
globalThis.renderTemplate = async () => "<p>craft result</p>";
globalThis.ChatMessage = {
  getSpeaker: () => ({ alias: "Crafter" }),
  create: async () => ({ id: "chat-1" })
};

globalThis.Roll = class {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
    this.total = 15;
    this.dice = [{ faces: 20, results: [{ result: 15 }] }];
  }

  async evaluate() {
    return this;
  }

  async render() {
    return "<div>15</div>";
  }
};

function makeItem(id, name, quantity) {
  return {
    id,
    name,
    type: "Basic",
    img: "icons/svg/item-bag.svg",
    uuid: `Actor.actor-1.Item.${id}`,
    system: { quantity },
    _stats: {},
    getFlag: () => null,
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        system: { quantity: this.system.quantity }
      };
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setProperty(this, path, value);
    }
  };
}

function makeActor() {
  const iron = makeItem("iron", "Iron", 4);
  const items = [iron];
  items.get = (id) => items.find((item) => item.id === id) ?? null;

  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Crafter",
    type: "character",
    isOwner: true,
    system: {
      abilities: { int: { mod: 0 } },
      coins: { gp: 10 }
    },
    items,
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setProperty(this, path, value);
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = items.findIndex((item) => item.id === id);
        if (index >= 0) items.splice(index, 1);
      }
    },
    async createEmbeddedDocuments() {
      throw new Error("simulated output creation failure");
    }
  };
  iron.parent = actor;
  return { actor, iron };
}

const { CraftingEngine } = await import("../scripts/crafting-engine.js");

test("output creation failure restores consumed material and gold", { concurrency: false }, async () => {
  const { actor, iron } = makeActor();
  errors.length = 0;

  const result = await CraftingEngine.craft(actor, recipe.id, {
    bookId: recipe.bookId,
    resourceActors: [actor]
  });

  assert.equal(result.outcome, "blocked");
  assert.deepEqual(result.consumed, []);
  assert.equal(result.createdItem, null);
  assert.equal(iron.system.quantity, 4);
  assert.equal(actor.system.coins.gp, 10);
  assert.equal(actor.items.length, 1);
  assert.deepEqual(errors, ["MKSDC.Notifications.OutputCreateFailed"]);
});
