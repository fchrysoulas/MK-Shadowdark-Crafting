export function getCraftingOutcome({ rollTotal, dc, d20 }) {
  const criticalSuccess = Number(d20) === 20;
  const criticalFailure = Number(d20) === 1;
  const success = criticalSuccess || (!criticalFailure && Number(rollTotal) >= Number(dc));

  if (criticalSuccess) return "criticalSuccess";
  if (criticalFailure) return "criticalFailure";
  if (success) return "success";
  return "failure";
}

export function getOutcomeConsumeQty(baseQty, outcome, {
  criticalSuccessHalfCost = false,
  consumeMaterialsOnFailure = false,
  criticalFailureLosesAll = false
} = {}) {
  const qty = Math.max(0, Number(baseQty) || 0);

  if (outcome === "criticalSuccess" && criticalSuccessHalfCost) {
    return Math.ceil(qty / 2);
  }

  if (outcome === "success" || outcome === "criticalSuccess") return qty;
  if (!consumeMaterialsOnFailure) return 0;
  if (outcome === "criticalFailure" && criticalFailureLosesAll) return qty;
  return Math.ceil(qty / 2);
}
