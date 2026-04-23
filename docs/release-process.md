# Release Process

> **Status:** stub — expanded with Phase 9.

## Cutting a release

1. Ensure `main` is green (CI passes).
2. Tick any remaining `todo/plan.md` checkboxes for the release.
3. Run `just release X.Y.Z`. This bumps versions, commits, tags, and
   pushes — CI picks up the tag and builds installers on all three OSes.

## Auto-update (`electron-updater`)

- Feed: GitHub Releases on `awapi/awapi-compare` (private).
- The packaged app embeds a read-only `GH_TOKEN` via the
  `GH_TOKEN` env var at `just package` time. **This token is embedded in
  the installer**; treat it as public-readable and scope it to
  "repo:public_read" style — rotate if leaked.
- Rotation: regenerate token in the release workflow's secrets and
  re-cut a release. Old installers continue to work with the old token
  until they auto-update.

## Code signing

Skipped for v1. When certificates are provisioned:

- macOS: Apple Developer ID + notarization. Set `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`.
- Windows: EV or OV certificate. Set `WIN_CSC_LINK`,
  `WIN_CSC_KEY_PASSWORD`.

Flip `forceCodeSigning` to `true` in `electron-builder.yml` once wired.
