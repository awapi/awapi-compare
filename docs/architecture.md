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
2. Renderer calls `window.awapi.fs.scan({ leftRoot, rightRoot, mode, rules })`.
3. Main `fsService` streams entries on both sides, applies rules, classifies.
4. Progress is pushed back via `fs.scan.progress` events.
5. Result is rendered as a twin virtualized tree.
