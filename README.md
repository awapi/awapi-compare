# AwapiCompare

A cross-platform (Windows, macOS, Linux) Beyond Compare alternative by
**Awapi**.

> **Status:** early scaffolding. Progress is tracked in
> [`todo/plan.md`](todo/plan.md).

## Features (v1 scope)

- Recursive folder compare with color-coded diff tree
- Text, binary/hex, and image file compare
- Copy left ↔ right with context menu and hotkeys
- Include/exclude rules with wildcards (`*`, `**`, `?`, negation)
- Inline text editing and save
- Session save/load
- CLI / launch flags: `awapi-compare --type folder --left <a> --right <b> [--mode quick|thorough|binary]`
  (see [`docs/user-guide.md`](docs/user-guide.md#command-line--launch-flags))
- Auto-updates via `electron-updater`
- 14-day free trial, then paid activation

## Installation

### macOS

1. Download the latest `.dmg` from the [Releases](https://github.com/awapi/awapi-compare/releases) page.
2. Open the `.dmg` and drag **AwapiCompare** into your `/Applications` folder.
3. Because the app is currently **not code-signed**, macOS Gatekeeper will warn on first launch. Right-click (or Control-click) **AwapiCompare.app** → **Open** → **Open** to bypass the warning.
   If that doesn't work, run this once in Terminal:
   ```bash
   xattr -cr "/Applications/AwapiCompare.app"
   ```
4. Launch AwapiCompare normally from Launchpad or Spotlight.

### Windows

1. Download the latest `.exe` or `.msi` installer from the [Releases](https://github.com/awapi/awapi-compare/releases) page.
2. Run the installer and follow the on-screen steps.

### Linux

1. Download the latest `.AppImage` or `.deb` from the [Releases](https://github.com/awapi/awapi-compare/releases) page.
2. **AppImage:** make it executable and run it:
   ```bash
   chmod +x AwapiCompare-*.AppImage && ./AwapiCompare-*.AppImage
   ```
   **deb:** install with `sudo dpkg -i AwapiCompare-*.deb`

## Stack

- Electron + React + TypeScript, bundled with `electron-vite`
- pnpm workspaces (`src/*`)
- `just` for dev/build/test/package/release
- Vitest (unit + coverage) and Playwright (E2E)

## Getting started

```bash
just install
just dev
```

See:

- [`docs/`](docs/) — end-user + developer documentation
- [`docs/contributing.md`](docs/contributing.md) — contributor workflow
- [`.github/copilot-instructions.md`](.github/copilot-instructions.md) —
  rules for automated agents

## License

Proprietary. See [`LICENSE.md`](LICENSE.md) and [`EULA.md`](EULA.md).

For commercial / licensing inquiries: legal@awapi.com
