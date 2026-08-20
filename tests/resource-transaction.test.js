import test from "node:test";
import assert from "node:assert/strict";

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

globalThis.game = {
  user: { isGM: true },
  i18n: {
    localize: (key) => key
  }
};

globalThis.foundry = {
  utils: { getProperty }
};

function makeItem(id, qty, { failOnce = false } = {}) {
  let shouldFail = failOnce;
  return {
    id,
    name: id,
    type: "Basic",
    uuid: `Actor.actor-1.Item.${id}`,
    system: { quantity: qty },
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        system: { quantity: this.system.quantity }
      };
    },
    async update(changes) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated item update failure");
      }
      if (Object.hasOwn(changes, "system.quantity")) this.system.quantity = changes["system.quantity"];
    }
  };
}

function makeItemsCollection(items) {
  const collection = [...items];
  collection.get = (id) => collection.find((item) => item.id === id) ?? null;
  return collection;
}

function makeActor(items) {
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Crafter",
    type: "character",
    isOwner: true,
    system: { coins: { gp: 10 } },
    items: makeItemsCollection(items),
    async update(changes) {
      if (Object.hasOwn(changes, "system.coins.gp")) this.system.coins.gp = changes["system.coins.gp"];
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = this.items.findIndex((item) => item.id === id);
        if (index >= 0) this.items.splice(index, 1);
      }
    },
    async createEmbeddedDocuments(_type, data) {
      const created = data.map((source) => makeItem(source._id, source.system?.quantity ?? 1));
      this.items.push(...created);
      return created;
    }
  };
  return actor;
}

const { ResourceTransaction } = await import("../scripts/resource-transaction.js");

test("partial material mutation failure rolls earlier changes back", async () => {
  const first = makeItem("first", 5);
  const second = makeItem("second", 5, { failOnce: true });
  const actor = makeActor([first, second]);
  const transaction = new ResourceTransaction([actor]);

  const allocations = [
    { actorId: actor.uuid, itemId: first.id, qty: 1, material: { name: "First" } },
    { actorId: actor.uuid, itemId: second.id, qty: 1, material: { name: "Second" } }
  ];

  await assert.rejects(() => transaction.consumeMaterialAllocations(allocations));
  const rollback = await transaction.rollback();

  assert.equal(rollback.ok, true);
  assert.equal(first.system.quantity, 5);
  assert.equal(second.system.quantity, 5);
});
