# Changelog

All notable changes to MK Shadowdark Crafting are documented here.

## 0.3.15

- Added explicit deconstruct recipe data to saved recipes.
- Added a Deconstruct Recipe section to the Recipe Editor so recovered materials can be edited separately from craft requirements.
- Automatically generates deconstruct materials from half the craft materials, rounded up, when the deconstruct recipe is left empty.
- Updated Deconstruct mode to list only owned inventory items that have a deconstruct recipe.
- Changed Craft and Deconstruct mode controls to icon-only buttons in the top header, next to Refresh, Manage Books, and Create Recipe.

## 0.3.13

- Updated the recommended deconstruction workflow to use the Crafting Panel Deconstruct view instead of registering right-click context menus by default.

## 0.3.12

- Added a Deconstruct context-menu option to the Item Directory/sidebar menu.
- Sidebar deconstruction uses the selected token actor first, then the assigned user character.
- Kept the actor inventory deconstruction context action.
- Added clearer warnings when no actor is selected or when the selected actor does not own the item.

## 0.3.11

- Added item deconstruction from actor inventory context menus.
- Deconstruction removes one crafted/output item and returns half of the materials that made it, rounded up.
- Deconstruction does not require a skill roll.
- Newly crafted items remember the actual consumed materials for more accurate deconstruction.
- Older items can still be deconstructed when they match an existing recipe output name and type.

## 0.3.10

- Crafting rolls now trigger Dice So Nice when the module is active.
- Crafting falls back to normal Foundry chat rolls when Dice So Nice is unavailable.

## 0.3.9

- Added Resource Sources to the Crafting UI.
- Scene character actors can be checked as shared material sources.
- Materials and gold are consumed in the displayed actor order.

## 0.3.8

- Fixed Recipe Editor save behavior for recipes with multiple material requirement rows.
- The editor now reads material groups directly from the DOM on save, preserving all rows and substitutes.
- Saving an edited recipe no longer drops previous required materials.

## 0.3.7

- Saved Concept B as the Dense List layout.
- Added Concept C as a Master Detail layout.
- Added a layout switcher to the Crafting UI toolbar.
- Layout preference is saved as a client setting per user.

## 0.3.6

- Reworked dense recipe rows into a horizontal grid.
- Column 1 shows output icon, recipe name, DC, ability, and duration.
- Column 2 shows materials and extra requirements.
- Column 3 shows craft, edit, and delete buttons.

## 0.3.5

- Moved DC, ability, and duration chips below the recipe title.
- Moved materials to their own line, closer to the compact list layout.

## 0.3.4

- Tightened the dense list layout.
- Reduced recipe row height and compacted sidebar, toolbar, material, and action spacing.
- Fixed search field focus loss by debouncing search renders and restoring cursor position after filtering.

## 0.3.3

- Reworked the Crafting UI into a dense single-column recipe list.
- Added recipe search and sorting.
- Kept the left recipe group tree and moved to compact inline material display.

## 0.3.2

- Changed primary recipe storage from world Item documents to Recipe Books in world settings.
- New recipes no longer create Items in the Items Directory.
- Crafting UI reads from active recipe books.
- Recipe Editor creates and updates recipes inside books.
- Recipe Book Manager can activate and deactivate books.
- Import creates recipe books instead of world recipe Items.
- Export exports recipe books from settings.
- Added migration from old item-based recipes into a new active book.
- Added editable recipe categories for the left-side recipe tree.
- Category defaults to the output item type, but does not change the crafted item type.
- Removed the Materials heading from recipe cards.
- Made recipe card material rows and card spacing more compact.

## 0.2.6

- Moved Save, Export, and Import recipe book actions out of the main Crafting screen.
- Added Export Book action to the Recipe Book Manager.
