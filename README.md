# MK Shadowdark Crafting

A lightweight crafting and downtime module for **Foundry VTT** and **Shadowdark RPG**.

MK Shadowdark Crafting stores recipes in **Recipe Books** saved to world settings. Crafting creates normal Shadowdark actor Items only when a recipe succeeds, so recipe setup does not clutter the Items Directory.

## Compatibility

- Foundry VTT: **v13-v14**
- Shadowdark RPG: **3.5.0 or later**, including current 4.x releases
- Current module version: **0.4.4**

## Features

- Crafting Panel available from token controls, actor sheet headers, or macro calls
- Recipe Books stored in world settings, with active/inactive book management
- GM recipe editor with categories, output quantity, DC, time, notes, gold cost, tool requirements, and station requirements
- Allowed ability checklist with advantage, normal, and disadvantage crafting rolls
- Search, sorting, Dense List, and Master Detail crafting layouts
- Drag-and-drop output items and material items
- Substitute material groups, such as `Rope x1 OR Bandages x3`
- Shared resource sources from explicitly checked scene character inventories
- Material and gold checking with configurable failure and critical-result consumption
- Transactional crafting and deconstruction with rollback on internal mutation failures
- Multi-stack and multi-actor material allocation
- Deconstruct mode with finite recovery pools for crafted batches
- Chat cards for crafting and deconstruction results
- Dice So Nice support when the module is active
- Recipe Book import and export as JSON
- Safe migration from older item-based recipe storage
- English and Greek localization

## Opening The Crafting Panel

You can open the Crafting Panel from:

- The token controls hammer button, if enabled in settings
- The actor sheet header button, if enabled in settings
- A macro or the browser console

```js
window.mkShadowdarkCrafting.open();
```

To open the panel for a specific actor:

```js
window.mkShadowdarkCrafting.open(game.user.character);
```

## Crafting Workflow

1. Open the Crafting Panel for an actor.
2. Make sure the header is in Craft mode.
3. Choose a recipe from the active Recipe Books.
4. If other scene character inventories are available, explicitly check the Resource Sources that may contribute materials.
5. Click Craft, choose an allowed ability and roll mode, then resolve the roll.

Only the primary crafter is selected as a resource source by default. Additional actors are opt-in.

The module plans all material groups against one shared inventory ledger before crafting. The same quantity cannot satisfy multiple requirement groups, substitute groups can backtrack to find a valid global combination, and duplicate stacks can contribute to the same requirement.

On success, the module consumes the planned materials and creates the crafted item on the actor. On failure, material loss depends on the world settings. Critical success and critical failure behavior can also be configured in settings.

Crafting resource changes are treated transactionally. If an internal item, currency, or output-creation mutation fails, the module attempts to restore the pre-craft inventory state and does not report the craft as successful.

## Deconstruction

Open the Crafting Panel and switch to Deconstruct mode using the recycle button in the header.

Deconstruct mode lists owned inventory items that have deconstruction data. Deconstructing removes one owned item and returns the configured recovered materials.

For automatically generated recovery on newly crafted multi-output batches, the module calculates a **finite recoverable pool for the whole batch**. Rounding occurs once at the batch level and each deconstructed output reduces the remaining pool, so deconstruction cannot manufacture extra resources by repeatedly rounding each output upward.

Legacy/untracked items use a conservative fallback calculation. Source-item removal and recovered-material changes are also transactional and are rolled back if the recovery operation fails partway through.

## Recipe Books

Open **Manage Books** from the Crafting Panel.

From the Recipe Book Manager, a GM can:

- Activate or deactivate recipe books
- Save the active recipes as a new book
- Export a book as JSON
- Import a book from JSON
- Rename a book
- Update a book from active recipes
- Delete a book
- Migrate old item-based recipes into a new recipe book

Only active books appear in the normal Crafting UI.

### Recipe Book visibility

Recipe Books are stored in a **world-scoped Foundry setting**. Inactive books are hidden from the normal Crafting UI, but **inactive does not mean secret**. Client-readable world settings must not be used to store GM secrets, unrevealed plot information, or hidden item text that must remain inaccessible to players.

Output item snapshots stored inside recipe data are deliberately reduced to the fields needed to recreate the crafted item: item name, type, image, Shadowdark `system` data, and sanitized embedded effects. Ownership, folders, document IDs, arbitrary module flags, effect origins, and third-party effect flags are not retained in the snapshot.

Recipes use **Saved Snapshot** output mode by default. When a saved snapshot exists, it is the authoritative output definition, so editing or deleting the Item that was originally dropped into the Recipe Editor does not silently change what the recipe creates. Older recipes that only contain an output UUID and no snapshot retain a legacy UUID fallback.

A GM can deliberately select **Linked Source** in the Recipe Editor. Linked Source resolves the current `outputUuid` when crafting and therefore intentionally follows later source-document changes. It can preserve data that the client-readable snapshot intentionally omits, but it is **not a secrecy boundary**: only use Linked Source when it is acceptable for the crafting client to resolve that source. If the linked source cannot be resolved, the module falls back to the saved safe snapshot when one exists.

If a future feature requires genuinely secret recipe books or secret linked-output blueprints, it should use GM-authoritative document/storage semantics rather than relying on inactive world-setting entries.

## Creating Recipes

A GM can click **Create Recipe** in the Crafting Panel.

In the Recipe Editor:

- Drop an item into the output slot to set what the recipe creates.
- Choose **Saved Snapshot** for deterministic output, or deliberately choose **Linked Source** when the output should follow the current source UUID.
- Set the output type, quantity, category, DC, time, and notes.
- Choose one or more abilities that can be used for crafting.
- Add optional gold, tool, and station requirements.
- Drop materials into the materials area.
- Drop additional materials into the same requirement row to create substitute options.
- Review or edit the Deconstruct Materials section.

Example:

```text
Torch requires:
- Oil Flask x1
- Scraps x3
- Rope x1 OR Bandages x3
```

## Migration From Old Versions

Older versions stored recipes as world Items with module flags. Current versions can migrate those safely into Recipe Books.

Open:

```text
Crafting Panel > Manage Books > Migrate Recipes
```

The migration copies old item-based recipes into a new active recipe book called **Migrated World Recipes**. The old Item Directory recipes are left untouched.

## Recipe Data

Recipe books are stored in:

```js
game.settings.get("mk-shadowdark-crafting", "recipeBooks");
```

Each book's `active` field is the module's authoritative active-state source. The historical setting below is retained as a compatibility mirror for older macros/integrations:

```js
game.settings.get("mk-shadowdark-crafting", "activeRecipeBookIds");
```

Recipe Book mutations are serialized per client and re-read the current world state immediately before modification to reduce stale whole-setting overwrites when several book operations happen close together.

## Public API

The module exposes a small helper API on `window.mkShadowdarkCrafting`:

```js
window.mkShadowdarkCrafting.open(actor);
window.mkShadowdarkCrafting.craft(actor, recipeId);
window.mkShadowdarkCrafting.deconstruct(actor, item);
window.mkShadowdarkCrafting.recipeBooks.openManager();
```

## Installation / Release Metadata

The repository URL is recorded in `module.json`.

`manifest` and `download` remain intentionally blank while this repository does not publish a packaged Foundry release asset. They should only be populated when a release workflow or manual release process produces stable `module.json` and module ZIP URLs. See [RELEASING.md](RELEASING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
