# Releasing MK Shadowdark Crafting

Use this checklist when preparing a published Foundry release.

## 1. Version and compatibility

- Update `module.json` `version`.
- Update the current version in `README.md`.
- Add the release entry to `CHANGELOG.md`.
- Confirm Foundry `minimum`, `verified`, and `maximum` values.
- Confirm the Shadowdark system minimum and current 4.x compatibility.

## 2. Regression checks

Run the automated integrity suite:

```bash
node --experimental-default-type=module --test tests/*.test.js
```

Then perform the module's manual Foundry regression pass on supported Foundry versions before publishing.

## 3. Package layout

The release ZIP should contain the module files at the ZIP root, including at minimum:

```text
module.json
scripts/
styles/
templates/
lang/
README.md
LICENSE
THIRD_PARTY_NOTICES.md
CHANGELOG.md
```

Do not package the repository itself as an extra parent directory inside the ZIP.

## 4. Manifest URLs

`module.json` always keeps:

```json
"url": "https://github.com/fchrysoulas/MK-Shadowdark-Crafting"
```

Until a stable packaged release asset exists, `manifest` and `download` remain intentionally blank.

Once releases consistently publish `module.json` and `module.zip`, use stable URLs such as:

```json
"manifest": "https://github.com/fchrysoulas/MK-Shadowdark-Crafting/releases/latest/download/module.json",
"download": "https://github.com/fchrysoulas/MK-Shadowdark-Crafting/releases/download/vVERSION/module.zip"
```

Replace `VERSION` with the exact release tag/version used by the packaging process. Do not publish these fields until those assets actually exist.

## 5. Before tagging

- Confirm `module.json`, `README.md`, and `CHANGELOG.md` agree on the version.
- Confirm tests pass.
- Confirm no GM-only or unrelated third-party metadata is present in recipe output snapshots.
- Confirm inactive Recipe Books are documented as non-secret client-readable data.
- Confirm the release ZIP installs successfully in Foundry.

## 6. After publishing

- Verify the GitHub release assets can be downloaded anonymously.
- Verify the manifest URL returns the published `module.json`.
- Verify the download URL returns the expected module ZIP.
- Install/update the module through Foundry using the published manifest URL.
