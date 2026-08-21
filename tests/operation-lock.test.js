import test from "node:test";
import assert from "node:assert/strict";
import { OperationCoordinatorQueue } from "../scripts/operation-lock.js";

test("operation coordinator grants exactly one request until release", async () => {
  const queue = new OperationCoordinatorQueue({ leaseMs: 10_000 });
  const granted = [];

  queue.enqueue({ requestId: "one", userId: "a" }, () => granted.push("one"));
  queue.enqueue({ requestId: "two", userId: "b" }, () => granted.push("two"));

  assert.deepEqual(granted, ["one"]);
  assert.equal(queue.active?.requestId, "one");

  assert.equal(queue.release("two"), false);
  assert.deepEqual(granted, ["one"]);

  assert.equal(queue.release("one"), true);
  assert.deepEqual(granted, ["one", "two"]);
  assert.equal(queue.active?.requestId, "two");

  queue.release("two");
});

test("cancel removes a queued request without disturbing the active holder", async () => {
  const queue = new OperationCoordinatorQueue({ leaseMs: 10_000 });
  const granted = [];

  queue.enqueue({ requestId: "one", userId: "a" }, () => granted.push("one"));
  queue.enqueue({ requestId: "two", userId: "b" }, () => granted.push("two"));
  queue.enqueue({ requestId: "three", userId: "c" }, () => granted.push("three"));

  assert.equal(queue.cancel("two"), true);
  queue.release("one");

  assert.deepEqual(granted, ["one", "three"]);
  assert.equal(queue.active?.requestId, "three");

  queue.release("three");
});
