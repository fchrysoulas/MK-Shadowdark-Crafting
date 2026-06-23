# MK Shadowdark Crafting

A lightweight crafting and downtime module for **Foundry VTT** and **Shadowdark RPG**.

MK Shadowdark Crafting stores recipes in **Recipe Books** saved to world settings. Crafting creates normal Shadowdark actor Items only when a recipe succeeds, so recipe setup does not clutter the Items Directory.

## Compatibility

- Foundry VTT: v12-v13 verified
- Shadowdark RPG: 3.5.0 or later
- Current module version: 0.4.1

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

## Installation

1. Unzip `mk-shadowdark-crafting.zip`.
2. Place the `mk-shadowdark-crafting` folder in your Foundry `Data/modules/` folder.
3. Restart Foundry VTT.
4. Enable **MK Shadowdark Crafting** in your world.

## Release Packaging

Build Foundry release assets from the version in `module.json`:

```powershell
.\release.ps1
```

This creates:

```text
dist/v<version>/module.json
dist/v<version>/mk-shadowdark-crafting.zip
```

To publish those assets to the matching GitHub release with the GitHub CLI:

```powershell
.\release.ps1 -Publish
```

Publishing creates the `v<version>` GitHub release if it does not exist. If the release already exists, the script replaces the attached `module.json` and `mk-shadowdark-crafting.zip` assets.

Publishing requires `gh` to be installed and authenticated with `gh auth login`.
Use `-Repository owner/repo` if the repository cannot be detected from `origin`.

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

## Deconstruction

Open the Crafting Panel and switch to Deconstruct mode using the recycle button in the header.

Deconstruct mode lists owned inventory items that have deconstruction data. Deconstructing removes one owned item and returns the configured recovered materials. New recipes can define deconstruction materials directly; if left empty, the editor generates a default recovery list from half of the first craft material choices, rounded up.

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

Active recipe book IDs are stored in:

```js
game.settings.get("mk-shadowdark-crafting", "activeRecipeBookIds");
```

## Public API

The module exposes a small helper API on `window.mkShadowdarkCrafting`:

```js
window.mkShadowdarkCrafting.open(actor);
window.mkShadowdarkCrafting.craft(actor, recipeId);
window.mkShadowdarkCrafting.deconstruct(actor, item);
window.mkShadowdarkCrafting.recipeBooks.openManager();
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
