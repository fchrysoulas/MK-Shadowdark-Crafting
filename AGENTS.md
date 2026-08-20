# AGENTS.md

## Project Scope

This repository contains **MK Shadowdark Crafting**, a Foundry VTT module that adds recipe books, crafting, shared resource sources, material consumption, deconstruction, recipe editing, and Shadowdark-aware item creation.

Keep changes focused on this module. Do not make unrelated formatting, dependency, naming, or architectural changes unless they are required for the task.

## Supported Environment

- Foundry VTT: **v13-v14**
- Shadowdark system: manifest minimum **3.5.0**; current development should remain compatible with modern **4.x** releases
- Module entrypoint: `scripts/module.js`
- Module manifest: `module.json`

Do not add compatibility shims for unsupported Foundry versions unless explicitly requested.

## Important Files

- `scripts/module.js` - hooks, scene controls, sheet integrations, public API
- `scripts/crafting-app.js` - main crafting UI and resource-source selection
- `scripts/crafting-engine.js` - crafting rolls, outcomes, consumption flow
- `scripts/deconstruction-engine.js` - deconstruction and material recovery
- `scripts/item-utils.js` - item lookup, quantities, actor resources, item creation
- `scripts/recipe-utils.js` - recipe normalization, requirement checks, recipe storage helpers
- `scripts/recipe-books.js` - recipe-book management and import/export
- `scripts/recipe-editor.js` - recipe editing UI
- `scripts/settings.js` - Foundry settings registration
- `scripts/constants.js` - module constants and compatibility fallbacks
- `templates/` - Handlebars templates
- `styles/` - module styling
- `lang/` - localization

## Core Integrity Rules

Crafting and deconstruction alter player inventory and currency. Treat these operations as economy-critical.

### Never allow resource duplication

The following invariant must always hold:

> Deconstruction must never return more material than the configured recoverable amount for the original crafted batch.

For multi-output recipes, do not round refunds independently per output in a way that increases the total recovered amount.

### Never double-count inventory

A material quantity may satisfy only one reserved requirement quantity.

When recipes contain multiple material groups or substitutes:

- Build a shared inventory ledger.
- Reserve quantities as requirements are allocated.
- Do not evaluate each group independently against the full inventory.
- If substitutes exist, prefer an allocation algorithm that can find a globally valid combination rather than selecting the first locally valid option.

### Aggregate duplicate stacks

If an actor owns several item documents representing the same material, all matching stacks must contribute to availability unless the recipe explicitly targets a specific item UUID.

Consumption may span multiple stacks and multiple explicitly selected resource actors.

### Crafting must be atomic

Do not leave partially consumed resources after an internal error.

A crafting operation should conceptually be:

1. Build a concrete resource allocation plan.
2. Validate the complete plan.
3. Roll the crafting check.
4. Revalidate immediately before mutation if needed.
5. Consume the planned materials/currency.
6. Create the crafted output.
7. Commit the result only if all required mutations succeed.
8. Restore prior state if any mutation fails.

If output creation fails, the result must not be reported as a successful craft.

### Deconstruction must be atomic

Removing the source item and granting recovered materials should behave as one transaction.

If refund creation or item updates fail, restore the original source item and any partially changed inventory state.

## Permissions and Player Safety

- Do not perform GM-only world-setting writes from ordinary player clients.
- Initialize or migrate world-scoped recipe data from an authorized GM client.
- Player-facing rendering should remain read-only with respect to world configuration.
- Shared resource actors should be opt-in. The primary crafter should be the only default selected source unless explicitly designed otherwise.
- Respect actor ownership and existing module settings before allowing crafting or deconstruction.

## Recipe and Item Data

- Prefer runtime Shadowdark item-type metadata over hard-coded historical type lists.
- Hard-coded type lists are fallbacks only.
- Do not reintroduce removed Shadowdark item types such as legacy `NPC Spell` when the active system does not support them.
- When storing output item snapshots in recipe data, keep only fields required to recreate the crafted item.
- Avoid copying unrelated third-party flags or hidden metadata into client-readable world settings.
- Do not assume inactive recipe books are secret if they are stored in client-readable settings.

## Foundry API Usage

- Prefer current APIs that work on the supported Foundry range.
- Avoid adding new ApplicationV1-only architecture.
- Existing `Application`, `FormApplication`, and legacy `Dialog` code may remain while v13-v14 support is required, but new work should be migration-friendly.
- Use current `Roll.evaluate()` semantics; do not add obsolete `{ async: true }` options.
- Preserve v13/v14 scene-control and ApplicationV2 header-hook compatibility.

## Coding Conventions

- Use clear, small helpers for pure allocation/refund math where possible.
- Prefer deterministic behavior for resource allocation and consumption order.
- Avoid hidden side effects in validation helpers.
- Validation functions should not mutate actor/item state.
- Keep UI state separate from inventory mutation logic.
- Escape user-provided strings when generating HTML manually.
- Preserve existing localization patterns for user-facing text.
- Do not silently swallow errors that can affect inventory, currency, or crafted outputs.

## Testing Expectations

Changes to crafting, requirements, materials, currency, or deconstruction should include regression coverage where practical.

Important cases:

- Repeated material groups sharing the same material.
- Substitute groups requiring backtracking.
- Multiple stacks of the same material on one actor.
- Shared resources across multiple actors.
- Normal success/failure and natural 1/20 behavior.
- Material and gold consumption rules.
- Output creation failure rollback.
- Partial mutation failure rollback.
- Multi-output recipe deconstruction.
- Partial deconstruction of a crafted batch.
- Deconstruction rollback.
- Runtime Shadowdark item-type detection.
- Recipe-book lookup/edit/delete behavior.

Key invariants:

1. **Allocation correctness:** reserved quantities never exceed actual available quantities.
2. **Atomicity:** internal failures leave inventory/currency in the pre-operation state.
3. **Conservation:** deconstruction cannot create net resources beyond the configured refund pool.

## Release and Versioning

When preparing a release:

- Keep `module.json`, `README.md`, and `CHANGELOG.md` version information synchronized.
- Verify Foundry compatibility declarations are accurate.
- Verify Shadowdark compatibility against the currently supported system version.
- Keep manifest repository/release URLs correct when distributing through GitHub/Foundry.
- Do not bump versions unless the task explicitly includes release preparation.

## Issue Priorities

For the current codebase, crafting-integrity issues take priority over UI modernization.

Fix in this order when relevant:

1. Material allocation correctness.
2. Transactional crafting and rollback.
3. Deconstruction conservation/refund correctness.
4. Output-creation failure handling.
5. Multi-stack material aggregation.
6. Permissions and world-setting initialization.
7. Compatibility cleanup.
8. Automated regression tests.
9. ApplicationV2 modernization and other refactors.

## Change Discipline

- Do not change unrelated files.
- Do not reformat large files solely for style.
- Do not rename public APIs without explicit instruction.
- Preserve recipe/import compatibility unless a migration is part of the task.
- If changing persisted recipe or crafted-item flag schemas, include backward-compatible handling or a migration path.
- Prefer a minimal fix that preserves existing behavior outside the target issue.
