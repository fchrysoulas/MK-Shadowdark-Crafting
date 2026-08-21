import test from "node:test";
import assert from "node:assert/strict";

function getProperty(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

const currentUser = { id: "gm-1", isGM: true, active: true };
globalThis.game = {
  user: currentUser,
  users: [currentUser],
  socket: {
    on() {},
    emit() {}
  },
  i18n: {
    localize: (key) => key
  }
};

globalThis.foundry = {
  utils: {
    getProperty,
    randomID: () => Math.random().toString(36).slice(2, 14)
  }
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

test("a transaction can reserve the operation lock before mutation", async () => {
  const actor = makeActor([]);
  const first = new ResourceTransaction([actor]);
  const second = new ResourceTransaction([actor]);

  await first.begin();
  let secondStarted = false;
  const secondPromise = second.begin().then(() => {
    secondStarted = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondStarted, false);

  await first.rollback();
  await secondPromise;
  assert.equal(secondStarted, true);
  await second.rollback();
});

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

test("rollback restores both material and gold after a later transaction failure", async () => {
  const iron = makeItem("iron", 5);
  const actor = makeActor([iron]);
  const transaction = new ResourceTransaction([actor]);
  const allocations = [{
    actorId: actor.uuid,
    itemId: iron.id,
    qty: 2,
    material: { name: "Iron" }
  }];

  assert.equal((await transaction.consumeMaterialAllocations(allocations)).ok, true);
  assert.equal((await transaction.consumeGold(4)).ok, true);
  assert.equal(iron.system.quantity, 3);
  assert.equal(actor.system.coins.gp, 6);

  const rollback = await transaction.rollback();

  assert.equal(rollback.ok, true);
  assert.equal(iron.system.quantity, 5);
  assert.equal(actor.system.coins.gp, 10);
});

test("concurrent transactions cannot both spend the same material quantity", async () => {
  const iron = makeItem("iron", 5);
  const actor = makeActor([iron]);
  const allocation = [{ actorId: actor.uuid, itemId: iron.id, qty: 3, material: { name: "Iron" } }];
  const first = new ResourceTransaction([actor]);
  const second = new ResourceTransaction([actor]);

  const firstResult = await first.consumeMaterialAllocations(allocation);
  assert.equal(firstResult.ok, true);
  assert.equal(iron.system.quantity, 2);

  let secondFinished = false;
  const secondPromise = second.consumeMaterialAllocations(allocation).then((result) => {
    secondFinished = true;
    return result;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondFinished, false, "second transaction should wait for the first lock holder");

  first.commit();
  const secondResult = await secondPromise;

  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.reason, "insufficientMaterial");
  assert.equal(iron.system.quantity, 2);
  await second.rollback();
});

test("concurrent transactions cannot lose gold deductions through stale writes", async () => {
  const actor = makeActor([]);
  const first = new ResourceTransaction([actor]);
  const second = new ResourceTransaction([actor]);

  const firstResult = await first.consumeGold(7);
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.consumed.length, 1);
  assert.equal(firstResult.consumed[0].kind, "gold");
  assert.equal(firstResult.consumed[0].qty, 7);
  assert.equal(actor.system.coins.gp, 3);

  let secondFinished = false;
  const secondPromise = second.consumeGold(7).then((result) => {
    secondFinished = true;
    return result;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondFinished, false, "second gold transaction should wait for the first lock holder");

  first.commit();
  const secondResult = await secondPromise;

  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.reason, "insufficientGold");
  assert.equal(actor.system.coins.gp, 3);
  await second.rollback();
});
