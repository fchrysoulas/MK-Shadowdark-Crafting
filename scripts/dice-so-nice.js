import { MODULE_ID } from "./constants.js";

export async function showDiceSoNiceRoll(roll, actor = null) {
  if (!roll || !game?.dice3d || typeof game.dice3d.showForRoll !== "function") return false;

  try {
    const speaker = actor ? ChatMessage.getSpeaker({ actor }) : null;

    await game.dice3d.showForRoll(
      roll,
      game.user,
      true,
      null,
      false,
      null,
      speaker
    );

    return true;
  } catch (error) {
    console.warn(`${MODULE_ID} | Dice So Nice animation failed`, error);
    return false;
  }
}
