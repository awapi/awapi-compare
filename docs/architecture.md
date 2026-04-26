# Architecture

> **Status:** stub — populated as phases land.

## Process model

- **Main process** (`src/desktop/src/main/`): privileged. Owns filesystem,
  network, credentials, app lifecycle. Services live in
  `src/desktop/src/main/services/`, each with an injectable interface so
  they can be unit-tested without importing `electron`.
- **Preload** (`src/desktop/src/preload/index.ts`): runs in an isolated
  world. Exposes the typed `AwapiApi` to the renderer via
  `contextBridge`.
- **Renderer** (`src/desktop/src/renderer/`): React app. No Node APIs.
  Talks to the main process only through `window.awapi`.

## Packages

- `@awapi/shared` — types + IPC channel contract, no runtime deps.
- `@awapi/licensing` — pure-logic licensing primitives (trial evaluator,
  provider interface). Electron-free.
- `@awapi/cli` — Commander-based CLI entry point.
- `@awapi/desktop` — the Electron application.

## Data flow (compare)

1. User picks two folders in the renderer.
2. Renderer calls `window.awapi.fs.scan({ leftRoot, rightRoot, mode, rules, diffOptions })`.
3. Main `fsService` streams entries on both sides, applies rules, pairs
   left ↔ right via `pairingKey(...)`, then classifies each pair via
   `classifyPair(..., { diffOptions })`.
4. Progress is pushed back via `fs.scan.progress` events.
5. Result is rendered as a twin virtualized tree.

The pairing rules, attribute checks (size, mtime tolerance, DST,
timezone), and content-comparison strategy live in
[`DiffOptions`](./diff-options.md). Include/exclude filters live in the
[rules engine](./rules-syntax.md) and run *before* pairing.

## Launch arguments

CLI flags / env vars passed to the Electron binary
(`--type folder --left … --right … [--mode …]`, or `AWAPI_LEFT` /
`AWAPI_RIGHT` / `AWAPI_MODE` / `AWAPI_TYPE`) are parsed in
`src/desktop/src/main/cliArgs.ts` (pure, electron-free, fully
unit-tested). The result is stashed on the `Services` object as
`initialCompare` and exposed to the renderer via the
`app.getInitialCompare` IPC channel. The renderer reads it once on
mount in `App.tsx` and pre-populates the first compare tab. See
[`docs/user-guide.md`](user-guide.md#command-line--launch-flags) for the
user-facing contract.

