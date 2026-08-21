import { MODULE_ID } from "./constants.js";

const LOCK_SETTING_KEY = "operationLockState";
const QUERY_PREFIX = `${MODULE_ID}.operation-lock`;
const QUERY_ACQUIRE = `${QUERY_PREFIX}.acquire`;
const QUERY_RELEASE = `${QUERY_PREFIX}.release`;
const QUERY_RENEW = `${QUERY_PREFIX}.renew`;
const QUERY_CANCEL = `${QUERY_PREFIX}.cancel`;
const DEFAULT_LEASE_MS = 120_000;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 180_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;
const RETRY_FLOOR_MS = 100;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function randomId(prefix = "op") {
  const id = globalThis.foundry?.utils?.randomID?.(24)
    || globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `${prefix}-${id}`;
}

function clampLeaseMs(value) {
  return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, Number(value) || DEFAULT_LEASE_MS));
}

function nowMs() {
  return Date.now();
}

function rotateRight(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Hex(value) {
  const bytes = Array.from(new TextEncoder().encode(String(value ?? "")));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + (index * 4);
      words[index] = (
        (bytes[base] << 24)
        | (bytes[base + 1] << 16)
        | (bytes[base + 2] << 8)
        | bytes[base + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}

export async function hashOperationLeaseToken(token) {
  const value = String(token || "");
  return value ? sha256Hex(value) : "";
}

export function normalizeOperationLockState(state = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const requestId = String(state.requestId || "").trim();
  const leaseHash = String(state.leaseHash || "").trim();
  const expiresAt = Number(state.expiresAt || 0);
  if (!requestId || !leaseHash || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return {
    schemaVersion: 1,
    requestId,
    coordinatorId: String(state.coordinatorId || "").trim(),
    leaseHash,
    expiresAt
  };
}

function canPersistLeaseState() {
  return Boolean(game?.user?.isGM && game?.settings?.get && game?.settings?.set);
}

function readPersistedLeaseState() {
  if (!game?.settings?.get) return null;
  try {
    return normalizeOperationLockState(game.settings.get(MODULE_ID, LOCK_SETTING_KEY));
  } catch (_error) {
    return null;
  }
}

async function writePersistedLeaseState(state) {
  if (!canPersistLeaseState()) return false;
  await game.settings.set(MODULE_ID, LOCK_SETTING_KEY, state || {});
  return true;
}

async function reservePersistedLease(grant) {
  if (!canPersistLeaseState()) return { ok: true };
  if (getOperationCoordinatorId() !== String(game?.user?.id || "")) {
    throw new Error("Operation-lock coordinator changed before the lease was granted.");
  }

  const current = readPersistedLeaseState();
  const now = nowMs();
  if (current && current.expiresAt > now) {
    return {
      ok: false,
      retryAfterMs: Math.max(RETRY_FLOOR_MS, current.expiresAt - now)
    };
  }

  const leaseHash = await hashOperationLeaseToken(grant.leaseToken);
  const next = {
    schemaVersion: 1,
    requestId: grant.requestId,
    coordinatorId: String(game.user?.id || ""),
    leaseHash,
    expiresAt: grant.expiresAt
  };
  await writePersistedLeaseState(next);

  const confirmed = readPersistedLeaseState();
  if (!confirmed || confirmed.requestId !== grant.requestId || confirmed.leaseHash !== leaseHash) {
    throw new Error("Could not reserve the persistent crafting economy lease.");
  }
  return { ok: true };
}

async function updatePersistedLeaseExpiry(requestId, leaseToken, expiresAt) {
  if (!canPersistLeaseState()) return false;
  const current = readPersistedLeaseState();
  if (!current || current.requestId !== String(requestId || "").trim()) return false;
  const leaseHash = await hashOperationLeaseToken(leaseToken);
  if (current.leaseHash !== leaseHash) return false;
  await writePersistedLeaseState({ ...current, coordinatorId: String(game.user?.id || current.coordinatorId || ""), expiresAt });
  return true;
}

async function clearPersistedLease(requestId, leaseToken) {
  if (!canPersistLeaseState()) return false;
  const current = readPersistedLeaseState();
  if (!current) return false;
  if (current.requestId !== String(requestId || "").trim()) return false;
  const leaseHash = await hashOperationLeaseToken(leaseToken);
  if (current.leaseHash !== leaseHash) return false;
  await writePersistedLeaseState({});
  return true;
}

async function expirePersistedLease(requestId, leaseToken) {
  const current = readPersistedLeaseState();
  if (!current || current.expiresAt > nowMs()) return false;
  return clearPersistedLease(requestId, leaseToken);
}

export function getPersistedOperationLeaseState() {
  return readPersistedLeaseState();
}

export async function reserveOperationLeaseState(grant) {
  return reservePersistedLease(grant);
}

export async function clearOperationLeaseState(requestId, leaseToken) {
  return clearPersistedLease(requestId, leaseToken);
}

export async function expireOperationLeaseState(requestId, leaseToken) {
  return expirePersistedLease(requestId, leaseToken);
}

export class OperationCoordinatorQueue {
  constructor({
    leaseMs = DEFAULT_LEASE_MS,
    beforeGrant = null,
    onRenew = null,
    afterRelease = null,
    tokenFactory = () => randomId("lease"),
    clock = nowMs
  } = {}) {
    this.defaultLeaseMs = clampLeaseMs(leaseMs);
    this.beforeGrant = typeof beforeGrant === "function" ? beforeGrant : null;
    this.onRenew = typeof onRenew === "function" ? onRenew : null;
    this.afterRelease = typeof afterRelease === "function" ? afterRelease : null;
    this.tokenFactory = tokenFactory;
    this.clock = clock;
    this.queue = [];
    this.active = null;
    this.pumping = false;
    this.retryTimer = null;
  }

  enqueue(request = {}) {
    const requestId = String(request.requestId || "").trim();
    const requestSecret = String(request.requestSecret || "").trim();
    if (!requestId || !requestSecret) return Promise.reject(new Error("Operation lock requests need an ID and private request secret."));

    if (this.active?.requestId === requestId || this.queue.some((entry) => entry.requestId === requestId)) {
      return Promise.reject(new Error("Duplicate operation lock request."));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        requestId,
        requestSecret,
        leaseMs: clampLeaseMs(request.leaseMs || this.defaultLeaseMs),
        resolve,
        reject
      });
      void this._pump();
    });
  }

  async cancel(requestId, requestSecret) {
    const id = String(requestId || "").trim();
    const secret = String(requestSecret || "").trim();

    if (this.active?.requestId === id && this.active.requestSecret === secret) {
      const grant = this.active;
      this._clearActiveTimer();
      this.active = null;
      try {
        if (this.afterRelease) await this.afterRelease(grant, { cancelled: true });
      } finally {
        this.wake();
      }
      return true;
    }

    const index = this.queue.findIndex((entry) => entry.requestId === id && entry.requestSecret === secret);
    if (index < 0) return false;
    const [entry] = this.queue.splice(index, 1);
    entry.reject(new Error("Operation lock request cancelled."));
    return true;
  }

  async release(requestId, leaseToken) {
    const id = String(requestId || "").trim();
    const token = String(leaseToken || "").trim();
    if (!this.active || this.active.requestId !== id || this.active.leaseToken !== token) return false;

    const grant = this.active;
    this._clearActiveTimer();
    this.active = null;
    try {
      if (this.afterRelease) await this.afterRelease(grant, { expired: false });
    } finally {
      this.wake();
    }
    return true;
  }

  async renew(requestId, leaseToken, leaseMs = null) {
    const id = String(requestId || "").trim();
    const token = String(leaseToken || "").trim();
    if (!this.active || this.active.requestId !== id || this.active.leaseToken !== token) return null;

    const nextLeaseMs = clampLeaseMs(leaseMs || this.active.leaseMs || this.defaultLeaseMs);
    const expiresAt = this.clock() + nextLeaseMs;
    const previousExpiresAt = this.active.expiresAt;
    this.active.leaseMs = nextLeaseMs;
    this.active.expiresAt = expiresAt;
    try {
      if (this.onRenew) await this.onRenew(this.active);
    } catch (error) {
      this.active.expiresAt = previousExpiresAt;
      throw error;
    }
    this._scheduleActiveExpiry(this.active);
    return { expiresAt, leaseMs: nextLeaseMs };
  }

  wake() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this._pump();
  }

  _clearActiveTimer() {
    if (this.active?.timer) clearTimeout(this.active.timer);
    if (this.active) this.active.timer = null;
  }

  _scheduleActiveExpiry(grant) {
    this._clearActiveTimer();
    const delay = Math.max(1, Number(grant.expiresAt) - this.clock());
    grant.timer = setTimeout(() => void this._expire(grant.requestId, grant.leaseToken), delay);
  }

  _scheduleRetry(delayMs) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this._pump();
    }, Math.max(RETRY_FLOOR_MS, Number(delayMs) || RETRY_FLOOR_MS));
  }

  async _expire(requestId, leaseToken) {
    if (!this.active || this.active.requestId !== requestId || this.active.leaseToken !== leaseToken) return;
    const grant = this.active;
    this._clearActiveTimer();
    this.active = null;
    try {
      if (this.afterRelease) await this.afterRelease(grant, { expired: true });
    } finally {
      this.wake();
    }
  }

  async _pump() {
    if (this.pumping || this.active || !this.queue.length) return;
    this.pumping = true;

    try {
      while (!this.active && this.queue.length) {
        const entry = this.queue[0];
        const leaseToken = this.tokenFactory();
        const grant = {
          requestId: entry.requestId,
          requestSecret: entry.requestSecret,
          leaseToken,
          leaseMs: entry.leaseMs,
          expiresAt: this.clock() + entry.leaseMs
        };

        try {
          const gate = this.beforeGrant ? await this.beforeGrant(grant) : { ok: true };
          if (gate?.ok === false) {
            this._scheduleRetry(gate.retryAfterMs);
            return;
          }

          this.queue.shift();
          if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
          }
          this.active = grant;
          this._scheduleActiveExpiry(grant);
          entry.resolve({
            requestId: grant.requestId,
            leaseToken: grant.leaseToken,
            leaseMs: grant.leaseMs,
            expiresAt: grant.expiresAt
          });
        } catch (error) {
          this.queue.shift();
          entry.reject(error);
        }
      }
    } finally {
      this.pumping = false;
      if (!this.active && this.queue.length && !this.retryTimer) void this._pump();
    }
  }
}

const coordinatorQueue = new OperationCoordinatorQueue({
  beforeGrant: reservePersistedLease,
  onRenew: (grant) => updatePersistedLeaseExpiry(grant.requestId, grant.leaseToken, grant.expiresAt),
  afterRelease: (grant, details = {}) => details.expired
    ? expirePersistedLease(grant.requestId, grant.leaseToken)
    : clearPersistedLease(grant.requestId, grant.leaseToken)
});
let queriesRegistered = false;

function getActiveUsers() {
  try {
    return Array.from(game?.users ?? []).filter((user) => Boolean(user?.active));
  } catch (_error) {
    return [];
  }
}

export function getOperationCoordinatorId() {
  const designatedGM = game?.users?.activeGM;
  if (designatedGM?.active && designatedGM?.isGM) return String(designatedGM.id || "").trim();

  const active = getActiveUsers().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const gms = active.filter((user) => Boolean(user?.isGM));
  if (gms.length) return String(gms[0]?.id || "").trim();
  if (active.length === 1) return String(active[0]?.id || "").trim();
  return "";
}

function getCoordinatorUser() {
  const coordinatorId = getOperationCoordinatorId();
  if (!coordinatorId) return null;
  return game?.users?.get?.(coordinatorId) ?? getActiveUsers().find((user) => String(user?.id || "") === coordinatorId) ?? null;
}

async function handleAcquireQuery(data = {}) {
  const selfId = String(game?.user?.id || "").trim();
  if (!selfId || getOperationCoordinatorId() !== selfId) {
    return { ok: false, reason: "coordinator-changed", coordinatorId: getOperationCoordinatorId() };
  }

  try {
    const grant = await coordinatorQueue.enqueue({
      requestId: data.requestId,
      requestSecret: data.requestSecret,
      leaseMs: data.leaseMs
    });
    return { ok: true, coordinatorId: selfId, ...grant };
  } catch (error) {
    return { ok: false, reason: error?.message || "lock-acquire-failed", coordinatorId: selfId };
  }
}

async function handleCancelQuery(data = {}) {
  const selfId = String(game?.user?.id || "").trim();
  if (!selfId) return { ok: false, reason: "no-user" };
  return { ok: await coordinatorQueue.cancel(data.requestId, data.requestSecret) };
}

async function handleReleaseQuery(data = {}) {
  const selfId = String(game?.user?.id || "").trim();
  if (!selfId || getOperationCoordinatorId() !== selfId) return { ok: false, reason: "coordinator-changed" };

  if (await coordinatorQueue.release(data.requestId, data.leaseToken)) return { ok: true };
  const recovered = await clearPersistedLease(data.requestId, data.leaseToken);
  if (recovered) coordinatorQueue.wake();
  return { ok: recovered, recovered };
}

async function handleRenewQuery(data = {}) {
  const selfId = String(game?.user?.id || "").trim();
  if (!selfId || getOperationCoordinatorId() !== selfId) return { ok: false, reason: "coordinator-changed" };

  const renewed = await coordinatorQueue.renew(data.requestId, data.leaseToken, data.leaseMs);
  if (renewed) return { ok: true, ...renewed };

  const current = readPersistedLeaseState();
  if (!current || current.requestId !== String(data.requestId || "").trim()) return { ok: false, reason: "lease-not-found" };
  const leaseHash = await hashOperationLeaseToken(data.leaseToken);
  if (current.leaseHash !== leaseHash) return { ok: false, reason: "lease-not-owned" };

  const leaseMs = clampLeaseMs(data.leaseMs || DEFAULT_LEASE_MS);
  const expiresAt = nowMs() + leaseMs;
  const updated = await updatePersistedLeaseExpiry(data.requestId, data.leaseToken, expiresAt);
  if (!updated) return { ok: false, reason: "lease-renew-failed" };
  coordinatorQueue.wake();
  return { ok: true, recovered: true, expiresAt, leaseMs };
}

export function registerOperationLockQueries() {
  if (queriesRegistered) return true;
  const queries = globalThis.CONFIG?.queries;
  if (!queries) return false;
  queries[QUERY_ACQUIRE] = handleAcquireQuery;
  queries[QUERY_CANCEL] = handleCancelQuery;
  queries[QUERY_RELEASE] = handleReleaseQuery;
  queries[QUERY_RENEW] = handleRenewQuery;
  queriesRegistered = true;
  return true;
}

async function queryCoordinator(queryName, data, timeoutMs) {
  const coordinator = getCoordinatorUser();
  const coordinatorId = String(coordinator?.id || "").trim();
  if (!coordinatorId) {
    const activeCount = getActiveUsers().length;
    if (activeCount > 1) throw new Error("An active GM is required for multiplayer-safe crafting operations.");
    throw new Error("No operation-lock coordinator is available.");
  }

  if (coordinatorId === String(game?.user?.id || "")) {
    switch (queryName) {
      case QUERY_ACQUIRE: return handleAcquireQuery(data);
      case QUERY_CANCEL: return handleCancelQuery(data);
      case QUERY_RELEASE: return handleReleaseQuery(data);
      case QUERY_RENEW: return handleRenewQuery(data);
      default: throw new Error(`Unknown operation-lock query: ${queryName}`);
    }
  }

  if (typeof coordinator.query !== "function") throw new Error("Foundry User.query() is unavailable for operation locking.");
  return coordinator.query(queryName, data, { timeout: Math.max(1_000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS) });
}

async function cancelQueuedRequestAt(coordinator, requestId, requestSecret) {
  if (!coordinator) return false;
  try {
    if (String(coordinator.id || "") === String(game?.user?.id || "")) {
      return Boolean((await handleCancelQuery({ requestId, requestSecret }))?.ok);
    }
    if (typeof coordinator.query !== "function") return false;
    const result = await coordinator.query(QUERY_CANCEL, { requestId, requestSecret }, { timeout: 2_000 });
    return Boolean(result?.ok);
  } catch (_error) {
    return false;
  }
}

function createLease(grant) {
  let released = false;
  let expiresAt = Number(grant.expiresAt || 0);
  const requestId = String(grant.requestId || "");
  const leaseToken = String(grant.leaseToken || "");
  const leaseMs = clampLeaseMs(grant.leaseMs || DEFAULT_LEASE_MS);
  let renewing = false;

  const renew = async () => {
    if (released || renewing) return false;
    renewing = true;
    try {
      const result = await queryCoordinator(QUERY_RENEW, { requestId, leaseToken, leaseMs }, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, leaseMs));
      if (!result?.ok) return false;
      expiresAt = Number(result.expiresAt || expiresAt);
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not renew crafting economy lease`, error);
      return false;
    } finally {
      renewing = false;
    }
  };

  const heartbeatMs = Math.max(2_000, Math.floor(leaseMs / 3));
  const heartbeat = setInterval(() => void renew(), heartbeatMs);

  return {
    requestId,
    leaseToken,
    leaseMs,
    get coordinatorId() {
      return getOperationCoordinatorId();
    },
    get expiresAt() {
      return expiresAt;
    },
    assertValid() {
      if (released) throw new Error("Crafting economy lease has already been released.");
      if (!Number.isFinite(expiresAt) || expiresAt <= nowMs()) throw new Error("Crafting economy lease expired before the operation completed.");
      return true;
    },
    renew,
    async release() {
      if (released) return false;
      released = true;
      clearInterval(heartbeat);
      try {
        const result = await queryCoordinator(QUERY_RELEASE, { requestId, leaseToken }, DEFAULT_REQUEST_TIMEOUT_MS);
        return Boolean(result?.ok);
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to release crafting economy lease`, error);
        return false;
      }
    }
  };
}

export async function acquireOperationLock({
  leaseMs = DEFAULT_LEASE_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  registerOperationLockQueries();

  const requestId = randomId("economy");
  const requestSecret = randomId("request");
  const normalizedLeaseMs = clampLeaseMs(leaseMs);
  const timeoutMs = Math.max(normalizedLeaseMs + 5_000, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  const deadline = nowMs() + timeoutMs;
  let lastError = null;

  while (nowMs() < deadline) {
    const remaining = Math.max(1_000, deadline - nowMs());
    let coordinator = null;
    try {
      coordinator = getCoordinatorUser();
      const result = await queryCoordinator(QUERY_ACQUIRE, {
        requestId,
        requestSecret,
        leaseMs: normalizedLeaseMs
      }, remaining);

      if (result?.ok) return createLease(result);
      if (result?.reason !== "coordinator-changed") throw new Error(`Operation lock rejected: ${result?.reason || "unknown"}`);
    } catch (error) {
      lastError = error;
      if (coordinator) await cancelQueuedRequestAt(coordinator, requestId, requestSecret);
      const currentCoordinatorId = getOperationCoordinatorId();
      const priorCoordinatorId = String(coordinator?.id || "");
      if (coordinator && currentCoordinatorId && currentCoordinatorId !== priorCoordinatorId) continue;
      break;
    } finally {
      if (coordinator && nowMs() >= deadline) {
        await cancelQueuedRequestAt(coordinator, requestId, requestSecret);
      }
    }
  }

  throw lastError || new Error("Timed out waiting for the crafting economy operation lock.");
}

if (globalThis.Hooks?.once) {
  Hooks.once("init", () => registerOperationLockQueries());
}
