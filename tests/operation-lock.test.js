import test from "node:test";
import assert from "node:assert/strict";

const store = { operationLockState: {} };
const gm1 = { id: "gm-1", isGM: true, active: true };
const gm2 = { id: "gm-2", isGM: true, active: false };
const users = [gm1, gm2];
users.get = (id) => users.find((user) => user.id === id) ?? null;

globalThis.game = {
  user: gm1,
  users,
  settings: {
    get: (_moduleId, key) => store[key],
    set: async (_moduleId, key, value) => {
      store[key] = structuredClone(value);
      return value;
    }
  }
};
globalThis.CONFIG = { queries: {} };
globalThis.foundry = {
  utils: {
    randomID: () => Math.random().toString(36).slice(2, 14)
  }
};

const {
  OperationCoordinatorQueue,
  clearOperationLeaseState,
  expireOperationLeaseState,
  getOperationCoordinatorId,
  getPersistedOperationLeaseState,
  hashOperationLeaseToken,
  reserveOperationLeaseState
} = await import("../scripts/operation-lock.js");

test("SHA-256 verifier does not depend on Web Crypto", async () => {
  assert.equal(
    await hashOperationLeaseToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("operation coordinator grants exactly one request until release", async () => {
  const queue = new OperationCoordinatorQueue({ leaseMs: 10_000, tokenFactory: () => `lease-${Math.random()}` });

  const first = await queue.enqueue({ requestId: "one", requestSecret: "secret-one" });
  let secondGranted = false;
  const secondPromise = queue.enqueue({ requestId: "two", requestSecret: "secret-two" }).then((grant) => {
    secondGranted = true;
    return grant;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondGranted, false);
  assert.equal(queue.active?.requestId, "one");

  assert.equal(await queue.release("one", "wrong-token"), false);
  assert.equal(queue.active?.requestId, "one");

  assert.equal(await queue.release(first.requestId, first.leaseToken), true);
  const second = await secondPromise;
  assert.equal(secondGranted, true);
  assert.equal(queue.active?.requestId, "two");

  await queue.release(second.requestId, second.leaseToken);
});

test("cancel requires the private request secret for queued and active requests", async () => {
  let releasedByCancel = 0;
  const queue = new OperationCoordinatorQueue({
    leaseMs: 10_000,
    tokenFactory: () => `lease-${Math.random()}`,
    afterRelease: async (_grant, details) => {
      if (details?.cancelled) releasedByCancel += 1;
    }
  });

  const first = await queue.enqueue({ requestId: "one", requestSecret: "secret-one" });
  const secondPromise = queue.enqueue({ requestId: "two", requestSecret: "secret-two" });

  assert.equal(await queue.cancel("two", "wrong-secret"), false);
  assert.equal(await queue.cancel("two", "secret-two"), true);
  await assert.rejects(secondPromise, /cancelled/);

  assert.equal(await queue.cancel("one", "wrong-secret"), false);
  assert.equal(queue.active?.requestId, "one");
  assert.equal(await queue.cancel("one", "secret-one"), true);
  assert.equal(queue.active, null);
  assert.equal(releasedByCancel, 1);

  assert.equal(await queue.release(first.requestId, first.leaseToken), false);
});

test("replacement coordinator queue remains blocked while an earlier lease is still active", async () => {
  let oldLeaseActive = true;
  const queue = new OperationCoordinatorQueue({
    leaseMs: 10_000,
    tokenFactory: () => "new-lease-token",
    beforeGrant: async () => oldLeaseActive ? { ok: false, retryAfterMs: 10_000 } : { ok: true }
  });

  let granted = false;
  const promise = queue.enqueue({ requestId: "new", requestSecret: "new-secret" }).then((grant) => {
    granted = true;
    return grant;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(granted, false);
  assert.equal(queue.active, null);

  oldLeaseActive = false;
  queue.wake();
  const grant = await promise;
  assert.equal(granted, true);
  assert.equal(grant.leaseToken, "new-lease-token");
  await queue.release(grant.requestId, grant.leaseToken);
});

test("persisted lease survives coordinator failover without exposing its release token", async () => {
  store.operationLockState = {};
  gm1.active = true;
  gm2.active = false;
  game.user = gm1;

  const oldToken = "old-private-token";
  const oldGrant = {
    requestId: "old-request",
    leaseToken: oldToken,
    expiresAt: Date.now() + 60_000
  };

  assert.deepEqual(await reserveOperationLeaseState(oldGrant), { ok: true });
  const persisted = getPersistedOperationLeaseState();
  assert.equal(persisted.requestId, "old-request");
  assert.equal(persisted.leaseHash, await hashOperationLeaseToken(oldToken));
  assert.notEqual(persisted.leaseHash, oldToken);

  gm1.active = false;
  gm2.active = true;
  game.user = gm2;
  assert.equal(getOperationCoordinatorId(), "gm-2");

  const blocked = await reserveOperationLeaseState({
    requestId: "new-request",
    leaseToken: "new-private-token",
    expiresAt: Date.now() + 60_000
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(getPersistedOperationLeaseState().requestId, "old-request");

  assert.equal(await clearOperationLeaseState("old-request", "wrong-token"), false);
  assert.equal(getPersistedOperationLeaseState().requestId, "old-request");
  assert.equal(await clearOperationLeaseState("old-request", oldToken), true);
  assert.equal(getPersistedOperationLeaseState(), null);
});

test("a stale coordinator expiry cannot clear a lease renewed past the old deadline", async () => {
  store.operationLockState = {};
  gm1.active = true;
  gm2.active = false;
  game.user = gm1;

  const token = "renewed-private-token";
  await reserveOperationLeaseState({
    requestId: "renewed-request",
    leaseToken: token,
    expiresAt: Date.now() + 60_000
  });

  assert.equal(await expireOperationLeaseState("renewed-request", token), false);
  assert.equal(getPersistedOperationLeaseState().requestId, "renewed-request");

  store.operationLockState.expiresAt = Date.now() - 1;
  assert.equal(await expireOperationLeaseState("renewed-request", token), true);
  assert.equal(getPersistedOperationLeaseState(), null);
});

test("multiple active non-GM clients do not elect an unsafe fallback coordinator", () => {
  const player1 = { id: "p1", isGM: false, active: true };
  const player2 = { id: "p2", isGM: false, active: true };
  game.users = [player1, player2];
  game.user = player1;
  assert.equal(getOperationCoordinatorId(), "");

  game.users = users;
  game.user = gm2;
});
