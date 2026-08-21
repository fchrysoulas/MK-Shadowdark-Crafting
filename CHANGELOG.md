# Changelog

All notable changes to MK Shadowdark Crafting are documented here.

## Unreleased

## 0.4.4

- Reject Recipe Book imports with malformed, non-integer, non-finite, unsafe, or out-of-range crafting quantities/costs before any world mutation; valid integer numeric strings remain supported.
- Revalidate required tools and stations after acquiring the final crafting economy lock so requirements removed during the dialog, roll, or lock wait cannot be bypassed.
- Made saved output snapshots deterministic: normal recipes now ignore later source-item edits, while an explicit Linked Source mode can intentionally follow the live output UUID; legacy UUID-only recipes keep their compatibility fallback.
- Keep at most one Crafting window per actor, so switching between actors and reopening an already-open actor reuses the existing ApplicationV2 window instead of creating duplicates.
- Hardened crafting/deconstruction economy serialization across coordinator failover using targeted Foundry user queries, renewable private lease tokens, and a hashed persistent lease record.
- Restyled the crafting, recipe editor, recipe book, dialog, and chat interfaces with a consistent high-contrast palette and Montserrat typography.
- Added visible ApplicationV2 scrollbars and a reliable Font Awesome close icon.
- Aligned Deconstruct mode with the Crafting dense-list hierarchy, spacing, typography, material order, and responsive behavior.
- Changed Recipe Editor ability choices to a borderless three-column by two-row layout.
- Simplified the Crafting header to show `Character Name - Crafting` beside the portrait.
- Made the character header reflect the active mode and removed the redundant Deconstruct Inventory title and hint.
- Restricted crafting execution to enabled recipes in active books; crafting now aborts if execution-critical recipe data changes before inventory mutation.
- Contained post-commit chat-card failures so completed crafting and deconstruction transactions remain successful while clearly warning the user that chat reporting failed.

## 0.4.3

- Extended Foundry VTT compatibility through v14 while retaining v13 as the minimum supported version.

## 0.4.2

- Removed Foundry VTT v12 compatibility and now require Foundry VTT v13.

## 0.4.1

- Validated Foundry VTT v13 scene control integration by supporting the v13 `Record<string, SceneControl>` control shape while keeping the v12 array shape.
- Added v13 ApplicationV2 actor sheet header-control support for the Crafting button.
- Updated manifest compatibility to verify and allow Foundry VTT v13.
- Resource Sources now show aggregated Basic material totals needed by active recipes for the selected scene sources instead of per-character source text on recipe rows.

## 0.4.0

- Made recipe actions book-aware so craft, edit, and delete target the correct recipe when multiple books are active.
- Fixed recipe book import behavior: merge now upserts recipes into the imported book ID, while create-copy imports regenerate recipe IDs.
- Added a Recipe Book selector to the Recipe Editor and safely removes the old copy when a recipe is moved between books.
- Prevented successful rolls from creating output items when material or gold consumption fails.
- Aligned Deconstruct preview and execution so both use the same recipe snapshot/current recipe resolution.
- Improved auto-generated deconstruction recovery for crafted items with recorded consumed materials.
- Tightened item matching to exact names or UUIDs to avoid consuming similarly named items.
- Fixed ability score handling for `.value` paths so scores such as 8 are converted to modifiers.
- Removed visible compendium recipe settings until compendium recipe loading is implemented.
- Limited manifest compatibility to Foundry VTT v12 pending a v13 ApplicationV2/control hook migration.

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
