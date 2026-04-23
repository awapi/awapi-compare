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
- CLI entry: `awapi-compare <left> <right>`
- Auto-updates via `electron-updater`
- 14-day free trial, then paid activation

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
