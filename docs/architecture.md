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

## File-diff dispatch (Phase 7)

Once the user opens a row in the compare tree, a dedicated *file-diff
tab* mounts. The dispatch is content-driven, not extension-driven:

1. The renderer hook `useFileDiffData` calls `window.awapi.fs.stat`
   followed by `window.awapi.fs.read` for each side, gating reads on
   the soft (`LARGE_FILE_BYTES`, 5 MiB) and hard
   (`MAX_TEXT_FILE_BYTES`, 50 MiB) limits.
2. The first ready buffer is fed to `classifyFile` from
   `@awapi/shared/fileKind`, which sniffs magic bytes (PNG/JPEG/GIF/
   WEBP/BMP) and falls back to a NUL-byte heuristic to choose
   `text` / `image` / `binary`.
3. `FileDiffTab` then mounts one of:
   - `<TextDiffView />` — Monaco `createDiffEditor`, lazy-loaded so
     test runs that never mount the editor don't pull the worker
     bundle. Inline edits round-trip via `fs.write` with
     `expectedMtimeMs` so the main process can reject silent overwrites
     with `E_EXTERNAL_MODIFICATION` (re-exported from `@awapi/shared`
     as `FS_ERROR_EXTERNAL_MODIFICATION`). On rejection the renderer
     prompts the user and reloads.
   - `<HexDiffView />` — virtualised 16-byte rows aligned by the pure
     block-LCS algorithm in `hexDiff.ts`. Hashes use FNV-1a; collisions
     are reconciled by an explicit byte compare during the LCS walk.
   - `<ImageDiffView />` — three modes (side-by-side, onion-skin,
     pixel-diff). Pixel diff is computed via the `pixelmatch` wrapper
     in `imageDiff.ts`. Images flow as `data:` URIs (CSP allows
     `img-src 'self' data:`).

The hex and pixel-diff algorithms live in `@awapi/shared` and the
renderer-only `imageDiff.ts` respectively, both with 100% line
coverage and no `electron` dependency.

### IPC channels added in Phase 7

- `IpcChannel.FsRead` (`fs.read`) — `{ path, maxBytes? }` →
  `{ data: Uint8Array, size, mtimeMs }`. Refuses files larger than
  `maxBytes ?? MAX_TEXT_FILE_BYTES` with `E_FILE_TOO_LARGE`.
- `IpcChannel.FsStat` (`fs.stat`) — `{ path }` →
  `{ size, mtimeMs, type }`.
- `FsWriteRequest.expectedMtimeMs` — optional guard; main rejects with
  `E_EXTERNAL_MODIFICATION` when the on-disk mtime drifts by more than
  ±1ms.

`FsCodedError` (`src/desktop/src/main/services/fsService.ts`) carries
the code and an optional details bag through `registerIpcHandlers`'
error wrapper so the renderer sees a structured `{ code, message }`
on rejection.


