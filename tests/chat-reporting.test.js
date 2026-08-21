import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

let warning = "";
globalThis.game = {
  user: { id: "user-1" },
  i18n: { localize: (key) => key }
};
globalThis.ui = {
  notifications: {
    warn: (message) => { warning = message; }
  }
};
globalThis.renderTemplate = async () => "<p>result</p>";
globalThis.ChatMessage = {
  getSpeaker: () => ({ alias: "Crafter" }),
  create: async () => { throw new Error("chat unavailable"); }
};

const { postCraftingChatCardSafely } = await import("../scripts/chat.js");

test("ChatMessage.create failure is contained and reported without throwing", async () => {
  warning = "";
  const result = await postCraftingChatCardSafely({ id: "actor-1" }, {});

  assert.equal(result.ok, false);
  assert.equal(result.message, null);
  assert.equal(result.error?.message, "chat unavailable");
  assert.equal(warning, "MKSDC.Notifications.ChatReportFailed");
});

test("successful post-commit chat returns a successful report", async () => {
  const message = { id: "message-1" };
  globalThis.ChatMessage.create = async () => message;

  const result = await postCraftingChatCardSafely({ id: "actor-1" }, {});
  assert.equal(result.ok, true);
  assert.equal(result.message, message);
  assert.equal(result.error, null);
});

test("consumed material and gold rows render the shared qty field", async () => {
  const template = await readFile(path.join(process.cwd(), "templates/chat-card.hbs"), "utf8");
  const consumedBlock = template.match(/\{\{#if consumed\.length\}\}([\s\S]*?)\{\{\/if\}\}/)?.[1] ?? "";

  assert.match(consumedBlock, /\{\{entry\.qty\}\}/);
  assert.doesNotMatch(consumedBlock, /entry\.amount/);
});

test("craft result chat is posted safely after transaction commit and returned to caller", async () => {
  const source = await readFile(path.join(process.cwd(), "scripts/crafting-engine.js"), "utf8");
  const commitIndex = source.indexOf("transaction.commit()");
  const chatIndex = source.indexOf("const chatReport = await postCraftingChatCardSafely", commitIndex);
  const returnIndex = source.indexOf("chatReport", chatIndex + 1);

  assert.ok(commitIndex >= 0);
  assert.ok(chatIndex > commitIndex, "safe chat reporting must happen after craft transaction completion");
  assert.ok(returnIndex > chatIndex, "craft caller must receive the chat report state");
});

test("deconstruction returns its committed result even when post-commit chat fails", async () => {
  const source = await readFile(path.join(process.cwd(), "scripts/deconstruction-engine.js"), "utf8");
  const mutationIndex = source.indexOf("await addOwnedMaterialQuantity");
  const finallyIndex = source.indexOf("} finally {", mutationIndex);
  const chatIndex = source.indexOf("const chatReport = await postCraftingChatCardSafely", finallyIndex);
  const returnIndex = source.indexOf("return { actor, recipe, item: consumedItem, recovered, chatReport }", chatIndex);

  assert.ok(mutationIndex >= 0);
  assert.ok(finallyIndex > mutationIndex);
  assert.ok(chatIndex > finallyIndex, "deconstruction chat must occur after the mutation/lock block");
  assert.ok(returnIndex > chatIndex, "deconstruction caller must receive the chat report state");
});
