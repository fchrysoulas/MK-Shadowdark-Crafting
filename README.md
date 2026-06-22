# MK Shadowdark Crafting

A lightweight crafting and downtime module for **Foundry VTT v12** and **Shadowdark RPG v3.5.0**.

## Current storage model - v0.3.2

Recipes are now stored inside **Recipe Books** in world settings. The module no longer creates fake recipe Items in the Items Directory when you create a new recipe.

Crafted output items are still created as real Shadowdark actor Items when crafting succeeds.

## Features

- Crafting Panel for selected actors
- Recipe Books stored in world settings
- Active/inactive recipe books
- Editable recipe Category for the left-side group tree
- Recipe Book Manager
- Import/export recipe books as JSON
- Safe migration tool for old item-based recipes
- Drag-and-drop output items
- Drag-and-drop input/material items
- Substitute material groups, such as `Rope x1 OR Bandages x3`
- Output quantity
- Material checking and consumption
- Scene resource source picker for crafting from checked character inventories
- Craft / Deconstruct mode in the Crafting Panel
- Deconstruction recovers half of the creating materials, rounded up, with no skill roll
- Crafting checks with allowed ability checklist
- Crafting popup with advantage, normal, and disadvantage
- Critical success and critical failure handling
- Chat cards for crafting results
- English and Greek localization

## Installation

1. Unzip `mk-shadowdark-crafting.zip`.
2. Place the `mk-shadowdark-crafting` folder inside your Foundry `Data/modules/` folder.
3. Restart Foundry VTT.
4. Enable **MK Shadowdark Crafting** in your world.

## Open the Crafting Panel

You can open the panel from:

- The token controls hammer button, if enabled in settings
- The actor sheet header button, if enabled in settings
- The browser console or a macro:

```js
window.mkShadowdarkCrafting.open();
```

Or for a specific actor:

```js
window.mkShadowdarkCrafting.open(game.user.character);
```


## Deconstruction

Open the Crafting Panel and switch from **Craft** to **Deconstruct**.

The Deconstruct view shows the active actor's owned inventory items that can be matched to a recipe output or that remember their crafted recipe. Clicking the recycle button removes one item and returns half of the materials used to create it, rounded up. No skill roll is required.

Right-click context menu deconstruction is not registered by default in v0.3.13; use the Crafting Panel Deconstruct view instead.

## Recipe Books

Open **Manage Books** from the Crafting Panel.

From the Recipe Book Manager, a GM can:

- activate or deactivate recipe books
- save the active recipes as a new book
- export a book as JSON
- import a book from JSON
- rename a book
- update a book from active recipes
- delete a book
- migrate old item-based recipes into a new recipe book

Only active books appear in the Crafting UI.

## Creating Recipes

A GM can click **Create Recipe** in the Crafting Panel.

In the Recipe Editor:

- Drop an item into the output slot to set what the recipe creates.
- Set the output quantity.
- Pick one or more abilities that can be used for crafting.
- Drop materials into the materials area.
- Drop additional materials into the same requirement row to create substitute options.

Example:

```text
Torch requires:
- Oil Flask x1
- Scraps x3
- Rope x1 OR Bandages x3
```

## Migration from old versions

Old versions stored recipes as world Items with module flags. v0.3.2 can migrate those safely.

Open:

```text
Crafting Panel > Manage Books > Migrate Recipes
```

This copies old item-based recipes into a new active recipe book called **Migrated World Recipes**. The old Item Directory recipes are left untouched.

## Recipe data

Recipe data is stored in:

```js
game.settings.get("mk-shadowdark-crafting", "recipeBooks")
```

Active books are tracked in:

```js
game.settings.get("mk-shadowdark-crafting", "activeRecipeBookIds")
```

## Suggested Shadowdark crafting logic

- Success: consume materials and create the item
- Failure: lose half materials if failure consumption is enabled
- Critical success: success with a special note or reduced cost if enabled
- Critical failure: lose all materials if enabled

## Changelog

### v0.3.2

- Added editable recipe Category.
- Category controls the left-side recipe tree/group.
- Category defaults to the output item type, but does not change the crafted item type.


### 0.3.2

- Changed primary storage from world Item documents to Recipe Books in world settings.
- New recipes no longer create Items in the Items Directory.
- Crafting UI reads from active recipe books.
- Recipe Editor creates and updates recipes inside books.
- Recipe Book Manager can activate/deactivate books.
- Import creates recipe books instead of world recipe Items.
- Export exports recipe books from settings.
- Added migration from old item-based recipes into a new active book.

### 0.2.6

- Moved Save/Export/Import recipe book actions out of the main Crafting screen.
- Added Export Book action to the Recipe Book Manager.


## 0.3.2

- Removed the Materials heading from recipe cards.
- Made recipe card material rows and card spacing more compact to reduce entry height.


## v0.3.3

- Reworked the Crafting UI into a Concept B style dense single-column recipe list.
- Added recipe search and sorting.
- Kept the left recipe group tree and moved to compact inline material display.

## v0.3.4

- Second pass on the Concept B dense list layout.
- Reduced recipe row height and tightened sidebar, toolbar, material, and action spacing.
- Fixed search field focus loss by debouncing search renders and restoring cursor position after filtering.


## v0.3.5

- Moved DC / ability / duration chips below the recipe title.
- Moved materials to their own line, closer to the Concept B layout.


## v0.3.6

- Reworked dense recipe rows into a true Concept B horizontal grid.
- Column 1: output icon, recipe name, DC / ability / duration.
- Column 2: materials and extra requirements.
- Column 3: craft / edit / delete buttons.


## v0.3.7

- Saved Concept B as the Dense List layout.
- Added Concept C as a Master-Detail layout.
- Added a layout switcher in the Crafting UI toolbar.
- Layout preference is saved as a client setting per user.


## v0.3.8

- Fixed Recipe Editor save behavior for recipes with multiple material requirement rows.
- The editor now reads material groups directly from the DOM on save, preserving all rows and substitutes.
- Saving an edited recipe no longer drops previous required materials.

## v0.3.9

- Added Resource Sources to the crafting UI.
- Scene character actors can be checked as shared material sources.
- Materials and gold are consumed in the displayed actor order.

## v0.3.10

- Crafting rolls now trigger Dice So Nice when the module is active.
- Crafting still falls back to normal Foundry chat rolls when Dice So Nice is unavailable.

## v0.3.11

- Added item deconstruction from actor inventory context menus.
- Deconstruction removes one crafted/output item and returns half of the materials that made it, rounded up.
- No skill roll is required.
- Newly crafted items remember the actual consumed materials for more accurate deconstruction.
- Older items can still be deconstructed when they match an existing recipe output name and type.


### 0.3.12

- Adds the Deconstruct context-menu option to the Item Directory/sidebar menu.
- Sidebar deconstruction uses the selected token actor first, then the assigned user character.
- Keeps the actor inventory deconstruction context action.
- Adds clearer warnings when no actor is selected or the selected actor does not own the item.

## 0.3.15

- Added explicit deconstruct recipe data to saved recipes.
- Recipe editor now has a Deconstruct Recipe section where recovered materials can be edited separately from craft requirements.
- If the deconstruct recipe is left empty, it is generated from half the craft materials, rounded up, on save.
- Deconstruct mode now only lists owned inventory items that have a deconstruct recipe.
- Craft and Deconstruct mode buttons are now icon-only buttons in the top header, next to Refresh, Manage Books, and Create Recipe.
