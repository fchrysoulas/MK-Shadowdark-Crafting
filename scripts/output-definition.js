export const OUTPUT_SOURCE_MODE = Object.freeze({
  SNAPSHOT: "snapshot",
  LINKED: "linked"
});

export function normalizeOutputSourceMode(value) {
  return String(value || "").trim().toLowerCase() === OUTPUT_SOURCE_MODE.LINKED
    ? OUTPUT_SOURCE_MODE.LINKED
    : OUTPUT_SOURCE_MODE.SNAPSHOT;
}

function cloneData(value, clone) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return clone(value);
}

/**
 * Resolve the base Item data for a crafted output.
 *
 * Snapshot mode is deterministic: a saved snapshot wins over the live UUID.
 * A UUID is consulted only for legacy recipes that do not have a snapshot.
 * Linked mode intentionally resolves the live UUID first and may therefore
 * follow source-document changes. Its fallback snapshot keeps linked recipes
 * craftable if the source later becomes temporarily unavailable.
 */
export async function resolveRecipeOutputDefinition(recipe = {}, {
  resolveUuid = async () => null,
  clone = (value) => structuredClone(value),
  onResolveError = null
} = {}) {
  const mode = normalizeOutputSourceMode(recipe.outputSourceMode);
  const outputUuid = String(recipe.outputUuid || "").trim();
  const snapshot = cloneData(recipe.outputItemData, clone);

  if (mode === OUTPUT_SOURCE_MODE.SNAPSHOT && snapshot) {
    return { data: snapshot, source: "snapshot", mode };
  }

  if (outputUuid) {
    try {
      const source = await resolveUuid(outputUuid);
      if (source) {
        const raw = typeof source.toObject === "function" ? source.toObject() : source;
        const data = cloneData(raw, clone);
        if (data) return { data, source: mode === OUTPUT_SOURCE_MODE.LINKED ? "linked" : "legacy-uuid", mode };
      }
    } catch (error) {
      if (typeof onResolveError === "function") onResolveError(error, outputUuid);
    }
  }

  if (snapshot) {
    return { data: snapshot, source: "snapshot-fallback", mode };
  }

  return { data: null, source: "manual", mode };
}
