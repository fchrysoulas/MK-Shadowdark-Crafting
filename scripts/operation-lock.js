import { MODULE_ID } from "./constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function randomId(prefix = "op") {
  const id = globalThis.foundry?.utils?.randomID?.(16)
    || globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `${prefix}-${id}`;
}

export class OperationCoordinatorQueue {
  constructor({ leaseMs = DEFAULT_LEASE_MS } = {}) {
    this.defaultLeaseMs = Math.max(1_000, Number(leaseMs) || DEFAULT_LEASE_MS);
    this.queue = [];
    this.active = null;
  }

  enqueue(request, onGrant) {
    const requestId = String(request?.requestId || "").trim();
    if (!requestId || typeof onGrant !== "function") throw new Error("Operation lock requests need an ID and grant callback.");

    if (this.active?.requestId === requestId || this.queue.some((entry) => entry.requestId === requestId)) return false;

    this.queue.push({
      requestId,
      userId: String(request?.userId || "").trim(),
      leaseMs: Math.max(1_000, Number(request?.leaseMs) || this.defaultLeaseMs),
      onGrant
    });
    this._pump();
    return true;
  }

  cancel(requestId) {
    const id = String(requestId || "").trim();
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.requestId !== id);
    return before !== this.queue.length;
  }

  release(requestId) {
    const id = String(requestId || "").trim();
    if (!this.active || this.active.requestId !== id) return false;

    if (this.active.timer) clearTimeout(this.active.timer);
    this.active = null;
    this._pump();
    return true;
  }

  _pump() {
    if (this.active || !this.queue.length) return;
    const entry = this.queue.shift();
    const timer = setTimeout(() => {
      if (this.active?.requestId !== entry.requestId) return;
      console.error(`${MODULE_ID} | Operation lock lease expired`, entry.requestId);
      this.active = null;
      this._pump();
    }, entry.leaseMs);

    this.active = { ...entry, timer };
    entry.onGrant();
  }
}

const coordinatorQueue = new OperationCoordinatorQueue();
const pendingRequests = new Map();
let socketRegistered = false;

function getActiveUsers() {
  try {
    return Array.from(game?.users ?? []).filter((user) => Boolean(user?.active));
  } catch (_error) {
    return [];
  }
}

export function getOperationCoordinatorId() {
  const active = getActiveUsers().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const gms = active.filter((user) => Boolean(user?.isGM));
  return String((gms[0] ?? active[0] ?? game?.user)?.id || "").trim();
}

function emitSocket(message) {
  if (!game?.socket?.emit) throw new Error("Foundry module socket is unavailable.");
  game.socket.emit(SOCKET_CHANNEL, message);
}

function makeLocalLease(requestId) {
  let released = false;
  return {
    requestId,
    coordinatorId: String(game?.user?.id || ""),
    async release() {
      if (released) return false;
      released = true;
      return coordinatorQueue.release(requestId);
    }
  };
}

function makeRemoteLease(requestId, coordinatorId) {
  let released = false;
  return {
    requestId,
    coordinatorId,
    async release() {
      if (released) return false;
      released = true;
      emitSocket({
        type: "operation-lock-release",
        requestId,
        coordinatorId,
        userId: String(game?.user?.id || "")
      });
      return true;
    }
  };
}

function handleSocketMessage(message = {}) {
  const type = String(message.type || "");
  const selfId = String(game?.user?.id || "");

  if (type === "operation-lock-acquire") {
    if (String(message.coordinatorId || "") !== selfId) return;
    if (getOperationCoordinatorId() !== selfId) {
      emitSocket({
        type: "operation-lock-rejected",
        requestId: message.requestId,
        targetUserId: message.userId,
        reason: "coordinator-changed"
      });
      return;
    }

    coordinatorQueue.enqueue(message, () => {
      emitSocket({
        type: "operation-lock-granted",
        requestId: message.requestId,
        coordinatorId: selfId,
        targetUserId: message.userId
      });
    });
    return;
  }

  if (type === "operation-lock-release") {
    if (String(message.coordinatorId || "") !== selfId) return;
    coordinatorQueue.release(message.requestId);
    return;
  }

  if (type === "operation-lock-cancel") {
    if (String(message.coordinatorId || "") !== selfId) return;
    coordinatorQueue.cancel(message.requestId);
    return;
  }

  if (String(message.targetUserId || "") !== selfId) return;
  const pending = pendingRequests.get(String(message.requestId || ""));
  if (!pending) return;

  if (type === "operation-lock-granted") {
    clearTimeout(pending.timer);
    pendingRequests.delete(message.requestId);
    pending.resolve(makeRemoteLease(message.requestId, String(message.coordinatorId || "")));
  } else if (type === "operation-lock-rejected") {
    clearTimeout(pending.timer);
    pendingRequests.delete(message.requestId);
    pending.reject(new Error(`Operation lock rejected: ${message.reason || "unknown"}`));
  }
}

export function registerOperationLockSocket() {
  if (socketRegistered || !game?.socket?.on) return false;
  game.socket.on(SOCKET_CHANNEL, handleSocketMessage);
  socketRegistered = true;
  return true;
}

export async function acquireOperationLock({
  leaseMs = DEFAULT_LEASE_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  registerOperationLockSocket();

  const requestId = randomId("economy");
  const userId = String(game?.user?.id || "").trim();
  const coordinatorId = getOperationCoordinatorId();
  if (!userId || !coordinatorId) throw new Error("No operation-lock coordinator is available.");

  if (coordinatorId === userId) {
    return new Promise((resolve) => {
      coordinatorQueue.enqueue({ requestId, userId, leaseMs }, () => resolve(makeLocalLease(requestId)));
    });
  }

  if (!game?.socket?.emit) throw new Error("Foundry module socket is unavailable for cross-client operation locking.");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      try {
        emitSocket({ type: "operation-lock-cancel", requestId, coordinatorId, userId });
      } catch (_error) {
        // The timeout result is already authoritative for this requester.
      }
      reject(new Error("Timed out waiting for the crafting economy operation lock."));
    }, Math.max(1_000, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));

    pendingRequests.set(requestId, { resolve, reject, timer });
    emitSocket({
      type: "operation-lock-acquire",
      requestId,
      coordinatorId,
      userId,
      leaseMs: Math.max(1_000, Number(leaseMs) || DEFAULT_LEASE_MS)
    });
  });
}

if (globalThis.Hooks?.once) {
  Hooks.once("ready", () => registerOperationLockSocket());
}
