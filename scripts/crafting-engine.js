import { MODULE_ID } from "./constants.js";
import { setting } from "./settings.js";
import { checkRecipeRequirements, getRecipeById } from "./recipe-utils.js";
import { createActorItemFromRecipe, getAbilityMod, getResourceActorsFromIds, normalizeResourceActors } from "./item-utils.js";
import { planMaterialGroups, sliceMaterialAllocations } from "./material-allocation.js";
import { ResourceTransaction } from "./resource-transaction.js";
import { postCraftingChatCard } from "./chat.js";
import { showDiceSoNiceRoll } from "./dice-so-nice.js";

function getD20Result(roll) {
  const d20 = roll.dice?.find((die) => die.faces === 20);
  const result = d20?.results?.find((entry) => !entry.discarded && !entry.rerolled);
  return Number(result?.result ?? 0);
}

function getOutcome({ rollTotal, dc, d20 }) {
  const criticalSuccess = d20 === 20;
  const criticalFailure = d20 === 1;
  const success = criticalSuccess || (!criticalFailure && rollTotal >= dc);

  if (criticalSuccess) return "criticalSuccess";
  if (criticalFailure) return "criticalFailure";
  if (success) return "success";
  return "failure";
}

function getOutcomeLabel(outcome) {
  const key = {
    criticalSuccess: "MKSDC.Outcome.CriticalSuccess",
    success: "MKSDC.Outcome.Success",
    failure: "MKSDC.Outcome.Failure",
    criticalFailure: "MKSDC.Outcome.CriticalFailure"
  }[outcome];
  return game.i18n.localize(key);
}

function getConsumeQty(baseQty, outcome) {
  const qty = Math.max(0, Number(baseQty) || 0);

  if (outcome === "criticalSuccess" && setting("criticalSuccessHalfCost")) {
    return Math.ceil(qty / 2);
  }

  if (outcome === "success" || outcome === "criticalSuccess") return qty;

  if (!setting("consumeMaterialsOnFailure")) return 0;

  if (outcome === "criticalFailure" && setting("criticalFailureLosesAll")) return qty;

  return Math.ceil(qty / 2);
}

function getCraftedConsumedMaterials(consumed = []) {
  const map = new Map();

  for (const entry of consumed) {
    if (entry?.kind !== "material") continue;
    const qty = Math.max(0, Number(entry.qty || 0));
    if (!qty) continue;

    const name = String(entry.name || "").trim();
    const uuid = String(entry.uuid || "").trim();
    const type = String(entry.type || "").trim();
    const img = String(entry.img || "icons/svg/item-bag.svg").trim();
    const key = uuid || `${name.toLocaleLowerCase()}|${type.toLocaleLowerCase()}`;
    const current = map.get(key) || { name, uuid, type, img, qty: 0 };
    current.qty += qty;
    map.set(key, current);
  }

  return Array.from(map.values()).filter((entry) => entry.name && entry.qty > 0);
}

function getAbilityLabel(ability) {
  return game.i18n.localize(`MKSDC.Ability.${String(ability || "int").toUpperCase()}`);
}

function getRollModeLabel(mode) {
  const key = {
    advantage: "MKSDC.RollMode.Advantage",
    normal: "MKSDC.RollMode.Normal",
    disadvantage: "MKSDC.RollMode.Disadvantage"
  }[mode] ?? "MKSDC.RollMode.Normal";
  return game.i18n.localize(key);
}

function getRollFormula(mode) {
  if (mode === "advantage") return "2d20kh + @mod";
  if (mode === "disadvantage") return "2d20kl + @mod";
  return "1d20 + @mod";
}

function getAllowedAbilities(recipe) {
  const valid = ["str", "dex", "con", "int", "wis", "cha"];
  const source = Array.isArray(recipe.abilities) && recipe.abilities.length ? recipe.abilities : [recipe.ability || "int"];
  const abilities = source
    .map((ability) => String(ability || "").toLowerCase().trim())
    .filter((ability) => valid.includes(ability));
  return Array.from(new Set(abilities.length ? abilities : ["int"]));
}

function buildOutcomeMaterialAllocations(materialPlan, outcome) {
  const allocations = [];

  for (const selection of materialPlan.selections ?? []) {
    const qty = getConsumeQty(selection.material?.qty, outcome);
    if (qty <= 0) continue;

    const sliced = sliceMaterialAllocations(selection.allocations, qty);
    if (!sliced.ok) {
      return {
        ok: false,
        material: selection.material,
        remaining: sliced.remaining,
        allocations
      };
    }
    allocations.push(...sliced.allocations);
  }

  return { ok: true, allocations };
}

async function showCraftingRollDialog(actor, recipe) {
  const allowedAbilities = getAllowedAbilities(recipe);
  const abilityOptions = allowedAbilities.map((ability) => {
    const mod = getAbilityMod(actor, ability);
    const sign = mod >= 0 ? "+" : "";
    return `<option value="${ability}">${getAbilityLabel(ability)} (${sign}${mod})</option>`;
  }).join("");

  const content = `
    <form class="mk-sdc mk-sdc-roll-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("MKSDC.Dialog.AbilityLabel")}</label>
        <select name="ability">${abilityOptions}</select>
      </div>
      <p class="hint">${game.i18n.localize("MKSDC.Dialog.RollModeHint")}</p>
    </form>`;

  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    new Dialog({
      title: game.i18n.format("MKSDC.Dialog.CraftRollTitle", { name: recipe.outputName }),
      content,
      buttons: {
        advantage: {
          icon: '<i class="fas fa-angle-double-up"></i>',
          label: game.i18n.localize("MKSDC.RollMode.Advantage"),
          callback: (html) => done({ ability: html.find("[name='ability']").val() || allowedAbilities[0], rollMode: "advantage" })
        },
        normal: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: game.i18n.localize("MKSDC.RollMode.Normal"),
          callback: (html) => done({ ability: html.find("[name='ability']").val() || allowedAbilities[0], rollMode: "normal" })
        },
        disadvantage: {
          icon: '<i class="fas fa-angle-double-down"></i>',
          label: game.i18n.localize("MKSDC.RollMode.Disadvantage"),
          callback: (html) => done({ ability: html.find("[name='ability']").val() || allowedAbilities[0], rollMode: "disadvantage" })
        }
      },
      default: "normal",
      close: () => done(null)
    }).render(true);
  });
}

export class CraftingEngine {
  static async craft(actor, recipeId, options = {}) {
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActor"));
      return null;
    }

    if (!actor.isOwner && !game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.NoActorPermission"));
      return null;
    }

    if (!game.user.isGM && !setting("allowPlayerCrafting")) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.PlayerCraftingDisabled"));
      return null;
    }

    const recipe = await getRecipeById(recipeId, { bookId: options.bookId });
    if (!recipe) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RecipeNotFound"));
      return null;
    }

    const recipeItem = { id: recipe.id, uuid: recipe.id, name: recipe.outputName, img: recipe.outputImg, type: recipe.outputType };
    let resourceActors = null;
    if (Array.isArray(options.resourceActors)) {
      resourceActors = normalizeResourceActors(actor, options.resourceActors);
    } else if (Array.isArray(options.resourceActorIds)) {
      resourceActors = getResourceActorsFromIds(actor, options.resourceActorIds);
    } else {
      resourceActors = normalizeResourceActors(actor, null);
    }

    const requirements = checkRecipeRequirements(actor, recipe, { resourceActors });
    const materialPlan = requirements.materialAllocation ?? planMaterialGroups(resourceActors, recipe.materialGroups ?? []);

    if (!requirements.ok) {
      ui.notifications.warn(game.i18n.localize("MKSDC.Notifications.RequirementsMissing"));
      await postCraftingChatCard(actor, {
        actor,
        recipe,
        recipeItem,
        requirements,
        outcome: "blocked",
        outcomeLabel: game.i18n.localize("MKSDC.Outcome.Blocked"),
        rollHtml: "",
        rollTotal: null,
        dc: recipe.dc,
        d20: null,
        consumed: [],
        createdItem: null,
        notes: requirements.missing
      });
      return null;
    }

    const rollConfig = await showCraftingRollDialog(actor, recipe);
    if (!rollConfig) return null;

    const ability = rollConfig.ability || recipe.ability || "int";
    const rollMode = rollConfig.rollMode || "normal";
    const mod = getAbilityMod(actor, ability);
    const roll = await new Roll(getRollFormula(rollMode), { mod }).evaluate();
    void showDiceSoNiceRoll(roll, actor);
    const d20 = getD20Result(roll);
    const outcome = getOutcome({ rollTotal: roll.total, dc: recipe.dc, d20 });
    const rollSuccess = outcome === "success" || outcome === "criticalSuccess";

    const consumed = [];
    const transactionFailureNotes = [];
    let transactionFailed = false;
    let createdItem = null;
    const transaction = new ResourceTransaction(resourceActors);

    try {
      const outcomePlan = buildOutcomeMaterialAllocations(materialPlan, outcome);
      if (!outcomePlan.ok) {
        transactionFailed = true;
        transactionFailureNotes.push(game.i18n.format("MKSDC.Notes.MaterialConsumptionFailed", {
          name: outcomePlan.material?.name || "",
          remaining: outcomePlan.remaining
        }));
        throw new Error("Material allocation could not be reduced to the requested outcome quantity.");
      }

      const materialResult = await transaction.consumeMaterialAllocations(outcomePlan.allocations);
      if (!materialResult.ok) {
        transactionFailed = true;
        const allocation = materialResult.allocation;
        transactionFailureNotes.push(game.i18n.format("MKSDC.Notes.MaterialConsumptionFailed", {
          name: allocation?.material?.name || allocation?.itemName || "",
          remaining: allocation?.qty || 0
        }));
        throw new Error(`Material transaction validation failed: ${materialResult.reason || "unknown"}`);
      }
      consumed.push(...(materialResult.consumed ?? []));

      if (setting("useGoldCost") && recipe.goldCost > 0) {
        const goldQty = getConsumeQty(recipe.goldCost, outcome);
        if (goldQty > 0) {
          const goldResult = await transaction.consumeGold(goldQty);
          if (!goldResult.ok) {
            transactionFailed = true;
            transactionFailureNotes.push(game.i18n.format("MKSDC.Notes.GoldConsumptionFailed", {
              remaining: goldResult.remaining ?? goldQty
            }));
            throw new Error(`Gold transaction validation failed: ${goldResult.reason || "unknown"}`);
          }
          consumed.push(...(goldResult.consumed ?? []));
        }
      }

      if (rollSuccess) {
        createdItem = await createActorItemFromRecipe(actor, recipe, {
          recipeId: recipe.id,
          recipeBookId: recipe.bookId,
          recipeName: recipe.outputName,
          createdQty: recipe.outputQty || 1,
          consumedMaterials: getCraftedConsumedMaterials(consumed),
          recipeSnapshot: recipe,
          quality: outcome === "criticalSuccess" ? "fine" : "standard"
        });

        if (!createdItem) {
          transactionFailed = true;
          throw new Error("Crafted output creation returned no item.");
        }
      }

      transaction.commit();
    } catch (error) {
      transactionFailed = true;
      console.error(`${MODULE_ID} | Crafting transaction failed`, error);
      const rollback = await transaction.rollback();
      consumed.length = 0;
      createdItem = null;

      if (rollSuccess) {
        transactionFailureNotes.push(game.i18n.localize("MKSDC.Notes.OutputNotCreated"));
        ui.notifications.error(game.i18n.localize("MKSDC.Notifications.OutputCreateFailed"));
      }

      if (!rollback.ok) {
        console.error(`${MODULE_ID} | Crafting rollback was incomplete`, rollback.errors);
      }
    }

    const rollHtml = await roll.render();
    const notes = [];
    if (outcome === "criticalSuccess") notes.push(game.i18n.localize("MKSDC.Notes.CriticalSuccess"));
    if (outcome === "criticalFailure") notes.push(game.i18n.localize("MKSDC.Notes.CriticalFailure"));
    if (transactionFailed) notes.push(...transactionFailureNotes);
    if (!rollSuccess && consumed.length) notes.push(game.i18n.localize("MKSDC.Notes.MaterialsLost"));
    if (!rollSuccess && !consumed.length) notes.push(game.i18n.localize("MKSDC.Notes.NoMaterialsLost"));

    const finalOutcome = transactionFailed ? "blocked" : outcome;
    const finalOutcomeLabel = transactionFailed ? game.i18n.localize("MKSDC.Outcome.Blocked") : getOutcomeLabel(outcome);

    await postCraftingChatCard(actor, {
      actor,
      recipe,
      recipeItem,
      requirements,
      outcome: finalOutcome,
      outcomeLabel: finalOutcomeLabel,
      rollHtml,
      rollTotal: roll.total,
      dc: recipe.dc,
      d20,
      rollAbility: ability,
      rollMode,
      rollModeLabel: getRollModeLabel(rollMode),
      consumed,
      createdItem,
      notes
    });

    return {
      actor,
      recipe,
      recipeItem,
      outcome: finalOutcome,
      roll,
      rollAbility: ability,
      rollMode,
      consumed,
      createdItem
    };
  }
}
