import { TEMPLATES } from "./constants.js";

export async function postCraftingChatCard(actor, data) {
  const content = await renderTemplate(TEMPLATES.CHAT_CARD, data);
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}
