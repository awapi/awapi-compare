# Release Process

> **Status:** stub — expanded with Phase 9.

## Cutting a release

1. Ensure `main` is green (CI passes).
2. Tick any remaining `todo/plan.md` checkboxes for the release.
3. Run `just release X.Y.Z`. This bumps versions, commits, tags, and
   pushes — CI picks up the tag and builds installers on all three OSes.

## Packaging targets

The `electron-builder.yml` config produces the following installer set
per platform. All targets ship both x64 and arm64 binaries.

| OS      | Targets                                  | Notes                                                |
| ------- | ---------------------------------------- | ---------------------------------------------------- |
| macOS   | `.dmg` + `.zip`                          | `.zip` is consumed by `electron-updater` on update.  |
| Windows | `.exe` (NSIS) + `.msi`                   | NSIS is the recommended installer; MSI is for IT.    |
| Linux   | `.AppImage` + `.deb`                     | `.AppImage` is consumed by `electron-updater`.       |

Local packaging of the **current OS** is done with `just package`.
Cross-platform packaging (e.g. building Windows installers from a Mac)
is done **only in CI** via `just package-all` — it requires Wine,
`fakeroot`, and other host-specific toolchains that we don't install on
developer machines.

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

Skipped for v1 — installers are **unsigned**. Users will see OS
warnings on first launch:

- **macOS:** Gatekeeper will refuse to open the app on first launch
  ("AwapiCompare is damaged and can't be opened" or "cannot be opened
  because the developer cannot be verified"). Users must right-click
  the app → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/AwapiCompare.app`.
- **Windows:** SmartScreen will display a "Windows protected your PC"
  dialog. Users must click **More info → Run anyway**.
- **Linux:** No warning for `.AppImage` (after `chmod +x`); `.deb`
  installs normally via `apt`/`dpkg`.

When certificates are provisioned:

- macOS: Apple Developer ID + notarization. Set `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`.
- Windows: EV or OV certificate. Set `WIN_CSC_LINK`,
  `WIN_CSC_KEY_PASSWORD`.

Flip `forceCodeSigning` to `true` in `electron-builder.yml` once wired.

## Local packaging quickstart

```bash
# macOS host: produce .dmg + .zip for x64 and arm64
just package mac

# Linux host: produce .AppImage + .deb for x64 and arm64
just package linux

# Windows host: produce .exe (NSIS) + .msi for x64 and arm64
just package win
```

Artifacts land in `release/`. The auto-update metadata files
(`latest-mac.yml`, `latest.yml`, `latest-linux.yml`) are generated
alongside the installers and must be uploaded to the GitHub Release.

