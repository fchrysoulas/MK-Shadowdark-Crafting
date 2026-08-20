# MK Shadowdark Crafting Release Checklist

Use this checklist when preparing an installable release.

## Version and compatibility

- Update `module.json` version.
- Update the README current module version to the same value.
- Add the release entry to `CHANGELOG.md`.
- Verify Foundry `minimum`, `verified`, and `maximum` compatibility values.
- Verify the declared Shadowdark system compatibility against the current supported release.

## Manifest and download metadata

Before publishing through GitHub or Foundry, populate and verify:

- `url` points to the project repository.
- `manifest` points to the published `module.json` used by Foundry updates.
- `download` points to the release ZIP asset for the exact module version.

Do not point `download` at an asset that has not been published yet.

## Validation

- Run the automated crafting integrity test suite.
- Perform the manual Foundry v13 smoke test.
- Perform the manual Foundry v14 smoke test.
- Confirm recipe-state migration from an older world containing `recipeBooks` and `activeRecipeBookIds`.
- Confirm a player can open the Crafting App without making world-setting writes.
- Confirm crafting and deconstruction rollback behavior with a test actor.
- Confirm multi-output deconstruction cannot return more than the stored recovery pool.

## Packaging

- Confirm the release ZIP contains `module.json`, scripts, templates, styles, languages, license, and required notices.
- Confirm no development-only files are required by the runtime module.
- Install the ZIP into a clean Foundry data directory and launch the module once before publishing.
