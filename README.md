# MK Shadowdark Crafting

A lightweight crafting and downtime module for **Foundry VTT** and **Shadowdark RPG**.

MK Shadowdark Crafting stores recipes in **Recipe Books** saved to world settings. Crafting creates normal Shadowdark actor Items only when a recipe succeeds, so recipe setup does not clutter the Items Directory.

## Compatibility

- Foundry VTT: v13-v14
- Shadowdark RPG: 3.5.0 or later
- Current module version: 0.4.3

## Features

- Crafting Panel available from token controls, actor sheet headers, or macro calls
- Recipe Books stored in world settings, with active/inactive book management
- GM recipe editor with categories, output quantity, DC, time, notes, gold cost, tool requirements, and station requirements
- Allowed ability checklist with advantage, normal, and disadvantage crafting rolls
- Search, sorting, Dense List, and Master Detail crafting layouts
- Drag-and-drop output items and material items
- Substitute material groups, such as `Rope x1 OR Bandages x3`
- Shared resource sources from checked scene character inventories
- Material and gold checking with configurable failure and critical-result consumption
- Deconstruct mode for recovering configured materials from owned inventory items
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
4. If other scene character inventories are available, check the Resource Sources that can contribute materials.
5. Click Craft, choose an allowed ability and roll mode, then resolve the roll.

On success, the module consumes the required materials and creates the crafted item on the actor. On failure, material loss depends on the world settings. Critical success and critical failure behavior can also be configured in settings.

Crafting inventory changes are handled transactionally. If an internal material, currency, or output-creation mutation fails, the module attempts to restore the pre-craft inventory state instead of leaving a partial craft behind.

## Deconstruction

Open the Crafting Panel and switch to Deconstruct mode using the recycle button in the header.

Deconstruct mode lists owned inventory items that have deconstruction data. Deconstructing removes one owned item and returns the configured recovered materials. New generated deconstruction data uses a finite recovery pool for the crafted batch, so multi-output recipes cannot create extra resources by rounding each output independently.

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

Only active books appear in the Crafting UI.

### Visibility and secrecy

Recipe Books are stored in a **world setting**. World-setting data is delivered to connected Foundry clients, so an inactive recipe book must **not** be treated as secret GM-only storage. Inactive means “not currently shown by the Crafting UI,” not “hidden from a technically capable client.”

Output item snapshots stored inside recipes are reduced to the fields needed to reconstruct the item: basic document identity, Shadowdark system data, sanitized effects, and flags belonging to the active game system. Arbitrary third-party flags, ownership, folder data, sort data, and other document metadata are not retained in the recipe snapshot.

If a future feature requires genuinely secret recipes, those recipes should move to permission-controlled Foundry Documents or another GM-authoritative storage mechanism rather than relying on inactive world-setting entries.

## Creating Recipes

A GM can click **Create Recipe** in the Crafting Panel.

In the Recipe Editor:

- Drop an item into the output slot to set what the recipe creates.
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

Older versions stored recipes as world Items with module flags. Later versions used separate `recipeBooks` and `activeRecipeBookIds` world settings.

The current storage model automatically migrates those world-setting values into one unified `recipeState` object from a GM client. The legacy settings remain registered only so existing worlds can be read during migration.

For old item-based recipes, open:

```text
Crafting Panel > Manage Books > Migrate Recipes
```

The migration copies old item-based recipes into a new active recipe book called **Migrated World Recipes**. The old Item Directory recipes are left untouched.

## Recipe Data

Recipe books, active-book IDs, and a revision counter are stored together in:

```js
game.settings.get("mk-shadowdark-crafting", "recipeState");
```

The shape is approximately:

```js
{
  schemaVersion: 3,
  initialized: true,
  revision: 12,
  activeBookIds: ["world-recipes"],
  books: {
    "world-recipes": { /* recipes... */ }
  }
}
```

The older `recipeBooks` and `activeRecipeBookIds` settings are migration inputs only and are no longer authoritative runtime storage.

## Public API

The module exposes a small helper API on `window.mkShadowdarkCrafting`:

```js
window.mkShadowdarkCrafting.open(actor);
window.mkShadowdarkCrafting.craft(actor, recipeId);
window.mkShadowdarkCrafting.deconstruct(actor, item);
window.mkShadowdarkCrafting.recipeBooks.openManager();
```

## Development Release Metadata

`module.json` is the authoritative version/compatibility declaration. Repository `url`, `manifest`, and `download` fields may remain blank while release packaging is still under development; populate them when publishing installable GitHub/Foundry release assets.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE.md).
