import { MODULE_ID, TEMPLATES } from "./constants.js";

export async function postCraftingChatCard(actor, data) {
  const content = await renderTemplate(TEMPLATES.CHAT_CARD, data);
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

/**
 * Post a result card after an inventory transaction has already committed.
 * Reporting must never turn a committed economy operation into a rejected call.
 */
export async function postCraftingChatCardSafely(actor, data) {
  try {
    const message = await postCraftingChatCard(actor, data);
    return { ok: true, message, error: null };
  } catch (error) {
    console.error(`${MODULE_ID} | Committed crafting result could not be posted to chat`, error);
    try {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.ChatReportFailed"));
    } catch (_notificationError) {
      // The reporting failure is already contained; notification failure must
      // not change the committed operation's result either.
    }
    return { ok: false, message: null, error };
  }
}
