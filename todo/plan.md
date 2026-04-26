# AwapiCompare — Plan

> **Source of truth for outstanding work.** Read [`todo/README.md`](./README.md) for the workflow.
> Only tick a checkbox when the change is merged to `main`.

Build **AwapiCompare**, a cross-platform (Windows/macOS/Linux) Beyond Compare alternative by Awapi, using Electron + React + TypeScript (Vite via `electron-vite`) with Monaco's diff editor. Folder/file compare, copy L↔R, wildcard include/exclude rules, inline edit, binary/hex, image diff, session save/load, CLI entry. Proprietary license, in-app 14-day trial + paid activation via LemonSqueezy + Keygen.sh. Auto-updates via `electron-updater` against a private GitHub Releases repo. `justfile` drives all dev workflows. Unsigned v1.

---

## Phase 0 — Bootstrap the persistent plan

- [x] Create `todo/` folder in repo root
- [x] Create `todo/plan.md` — this file
- [x] Create `todo/README.md` — workflow documentation

## Phase 1 — Project scaffolding & repo layout

- [x] Top-level layout: `src/`, `docs/`, `tests/`, `todo/`, `.github/`, `resources/`
- [x] Root files: `justfile`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `electron-builder.yml`, `LICENSE.md`, `EULA.md`, `README.md` (update), `.gitignore`, `.editorconfig`, `.nvmrc`, `.node-version`
- [x] `pnpm-workspace.yaml` lists `src/*`
- [x] Workspaces: `src/desktop/` (Electron), `src/shared/`, `src/licensing/`, `src/cli/`
- [x] Bootstrap `electron-vite` in `src/desktop/` (main/preload/renderer with HMR)
- [x] Tooling: ESLint (typescript-eslint), Prettier, Vitest + `@vitest/coverage-v8`, Playwright for Electron E2E, `tsx`
- [x] Root `tsconfig.base.json`; per-package `tsconfig.json` extends base, strict mode
- [x] `LICENSE.md` (proprietary) and `EULA.md` committed
- [x] `THIRD_PARTY_NOTICES.md` generator wired in (runs at package time)

## Phase 2 — GitHub Copilot instructions + docs skeleton

- [x] `.github/copilot-instructions.md` per decisions (layout rules, todo/plan rule, IPC, testing, licensing, don't-edit list)
- [x] `.github/ISSUE_TEMPLATE/bug.md`, `.github/ISSUE_TEMPLATE/feature.md`
- [x] `.github/pull_request_template.md` (includes "ticked matching `todo/plan.md` box" check)
- [x] Doc stubs under `docs/`: `architecture.md`, `user-guide.md`, `rules-syntax.md`, `licensing.md`, `release-process.md`, `contributing.md`, `testing.md`

## Phase 3 — Electron shell & IPC boundary

- [x] `electron-vite.config.ts` with three entries (main/preload/renderer)
- [x] Main `BrowserWindow` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- [x] `src/shared/src/ipc.ts` — typed channel contracts (`fs.*`, `session.*`, `rules.*`, `license.*`, `updater.*`, `sftp.*` stub)
- [x] `src/shared/src/types.ts` — `Entry`, `DiffStatus`, `Rule`, `Session`
- [x] Preload `contextBridge.exposeInMainWorld('awapi', api)` typed client
- [x] Main services skeleton in `src/desktop/src/main/services/`: `fsService`, `hashService`, `diffService`, `rulesService`, `sessionService`, `sftpService` (stub), `licenseService`, `updaterService`, `cliService`
- [x] App menu + hotkeys (File / Edit / View / Help)
- [x] Unit tests for IPC type guards + preload bridge shape

## Phase 4 — Folder compare engine *(parallel with Phase 5)*

- [x] Streaming recursive scanner (async generator + backpressure) with progress events
- [x] Metadata: name, relPath, size, mtime, type, permissions; symlink + cycle guard
- [x] Compare modes: **quick** (size+mtime), **thorough** (streamed SHA-256), **binary** byte-by-byte
- [x] Classifier: `left-only`, `right-only`, `identical`, `different`, `newer-left`, `newer-right`
- [x] Per-entry error capture (no aborts on permission errors)
- [x] Apply include/exclude rules during scan
- [x] Unit tests (memfs): classifier matrix, symlink cycle, empty dirs, large-tree simulation

## Phase 5 — Renderer UI *(parallel with Phase 4)*

- [x] Layout: toolbar, twin virtualized tree/table (`@tanstack/react-virtual`), status bar
- [x] Zustand session store; serializable snapshot
- [x] Beyond-Compare-like color scheme (light/dark); persist theme
- [x] Context menu + hotkeys: Copy L→R / R→L / Delete / Open / Compare / Mark same / Exclude
- [x] Double-click pair → open file-diff tab
- [x] Tabbed workspace (multiple sessions + file diffs)
- [x] Component unit tests (Vitest + RTL)

## Phase 6 — Rules engine (include/exclude with wildcards)

- [x] `picomatch` for globs (`*`, `**`, `?`, `[abc]`, `!negation`)
- [x] Rule types: filename, path, size, mtime
- [x] Rule sets: global + per-session
- [x] Rules editor UI with live test-string preview
- [x] Unit tests: full glob matrix, negation precedence, ordering, size/mtime predicates
- [x] Write `docs/rules-syntax.md`

## Phase 6.1 — Beyond-Compare-style "Simple" rules view

Today's rules editor exposes the full ordered, last-match-wins model
with `kind` × `target` × `pattern` (+ optional `size` / `mtime`). It is
strictly more expressive than Beyond Compare's four-box Name Filters
dialog (Include files / Exclude files / Include folders / Exclude
folders) but the cost is real: users must mentally pick `kind` and
`target` for every rule, encode "is this a file or a folder?" in the
glob, and reason about the whitelist-mode flip the moment any include
rule exists.

Goal: keep today's engine as the source of truth, but front it with a
BC-style **Simple** view as the default, with today's editor moved
behind an **Advanced** tab. Round-trips losslessly; rule sets that use
features the simple view can't express (size/mtime predicates, custom
ordering, mixed file/folder targets) show a banner and force Advanced.

- [ ] Extend `Rule` in `src/shared/src/types.ts` with optional
  `scope: 'file' | 'folder' | 'any'` (default `'any'` for back-compat)
  and document semantics in `docs/rules-syntax.md`
- [ ] Update the matcher in `src/shared/src/` (and any scanner usage in
  `src/desktop/src/main/services/`) to honour `scope` — `'file'` rules
  only match file entries, `'folder'` rules only match directories
- [ ] Add `compileSimpleRules({ includeFiles, excludeFiles,
  includeFolders, excludeFolders })` pure helper in `src/shared/src/`
  that emits the canonical ordered rule list
  (excludeFolders → excludeFiles → includeFolders → includeFiles,
  with default `**` / `*` includes only emitted when the user changed
  them) — 100% unit-test coverage
- [ ] Add `tryDecompileToSimpleRules(rules)` inverse helper that
  returns either the four-box payload or `null` when the rule set uses
  advanced features (predicates, reordering, negation in unsupported
  positions, mixed scopes) — full test matrix
- [ ] Renderer: rules editor gets a tabbed shell with **Simple**
  (default) and **Advanced** (today's editor) tabs; Simple shows four
  textareas mirroring BC's Name Filters layout
- [ ] Banner in Simple tab when `tryDecompileToSimpleRules` returns
  `null`: "this rule set uses advanced features — edit in Advanced tab"
- [ ] Live preview pane (`rules.test` IPC) works from both tabs
  unchanged
- [ ] RTL component tests: editing each box updates the compiled rule
  list; switching tabs preserves edits; banner appears for advanced
  rule sets
- [ ] Update `docs/rules-syntax.md` and `docs/user-guide.md` with the
  Simple ↔ Advanced mapping table

## Phase 6.5 — Diff options (per-session match policy)

A configurable policy that controls how files are paired across sides
and which attributes count as "the same" — the engine layer underneath
the existing rules filter. Modeled conceptually on the per-view
"comparison" settings other folder-compare tools expose, but with an
original API surface (`DiffOptions`) and original UI naming.

- [x] `DiffOptions` types + `DEFAULT_DIFF_OPTIONS` in `src/shared/src/types.ts` (attributes: size, mtime+tolerance+DST+timezone; pairing: case, extension, Unicode normalization; content: mode + skip-when-attributes-match + override)
- [x] Pure helpers in `src/shared/src/diffOptions.ts` (`mergeDiffOptions`, `diffOptionsFromMode`, `mtimeDeltaWithinTolerance`) with 100% test coverage
- [x] Pure pairing key in `src/desktop/src/main/services/pairing.ts` (`pairingKey(relPath, options)`) with full test matrix
- [x] `classifyPair` accepts `DiffOptions`; `MTIME_EPSILON_MS` becomes a default fed into options; existing tests preserved
- [x] `FsService.scan` threads `DiffOptions` through (back-compat: derived from `req.mode` when omitted) and uses `pairingKey` to bucket entries
- [x] Extend `FsScanRequest` and `Session` with optional `diffOptions`; preload bridge passes through
- [x] Per-tab session store holds `diffOptions` (persisted via `toSnapshot` / `loadSnapshot`)
- [x] `DiffOptionsDialog` modal component with tabs (Match · Pairing · Content · Filters · Misc); opened from a new toolbar button
- [x] RTL component test for the dialog (default values, edits propagate, tab switching)
- [x] `docs/diff-options.md` + cross-link from `docs/rules-syntax.md` and `docs/architecture.md`

## Phase 7 — File compare views

- [ ] Text diff via Monaco `DiffEditor` with syntax highlighting
- [ ] Inline edit + save via `fs.write` with confirm; detect external modification
- [ ] Binary/hex view: virtualized 16-byte rows, synchronized scroll, block-LCS diff
- [ ] Image diff: side-by-side + onion-skin + `pixelmatch` canvas
- [ ] Chunked file reads; warn on large files
- [ ] Unit tests: hex diff algorithm, pixelmatch wrapper, save flow (memfs)

## Phase 8 — Licensing, trial, activation

- [ ] `src/licensing` with pluggable `Provider` interface
- [ ] Default provider: Keygen.sh
- [ ] First-run: install UUID in `userData/license.json`; 14-day trial
- [ ] Activation: key → Keygen → Ed25519-signed token → `safeStorage` encrypted
- [ ] Offline verify on launch; 7-day online re-check
- [ ] Read-only mode on expiry/invalid/revoke
- [ ] EULA first-run gate; acceptance persisted
- [ ] Unit tests: trial expiry + clock skew, Ed25519 verify, safeStorage round-trip, gating
- [ ] Integration test with `msw/node` mocked Keygen
- [ ] LemonSqueezy → Keygen webhook documented in `docs/licensing.md`

## Phase 9 — Packaging, auto-update, justfile

- [ ] `electron-builder.yml`: nsis (x64+arm64), dmg+zip universal macOS, AppImage+deb (x64+arm64)
- [ ] `publish: github` with private repo `awapi/awapi-compare` + `GH_TOKEN`
- [ ] `electron-updater` check on launch + menu item; background download; restart prompt
- [ ] Signing hooks stubbed; document Gatekeeper/SmartScreen warnings in `docs/release-process.md`
- [ ] `justfile` recipes:
  - [ ] `just install` / `just dev` / `just clean`
  - [ ] `just lint` / `just fmt` / `just typecheck`
  - [ ] `just test` (vitest + coverage) / `just test-e2e` / `just coverage`
  - [ ] `just build` / `just package [target]` / `just package-all` (CI only)
  - [ ] `just release VERSION` (bump + tag + push)
  - [ ] `just notices` (regenerate `THIRD_PARTY_NOTICES.md`)
  - [ ] `just cli` (run built CLI)

## Phase 10 — CLI entry point

- [ ] `src/cli` with `commander`: `awapi-compare <left> <right> [--mode quick|thorough] [--rules file]`
- [ ] Windows PATH shim via installer; macOS/Linux opt-in symlink to `/usr/local/bin`
- [ ] Handoff to running app via IPC socket; else new instance pre-loaded
- [ ] Unit tests: argument parser

## Phase 11 — Release engineering (GitHub Actions)

- [ ] `.github/workflows/ci.yml`: PR — lint + typecheck + unit + build
- [ ] `.github/workflows/release.yml`: tag `v*` — matrix ubuntu/macos/windows → `just package` → `electron-builder --publish always`
- [ ] Secret placeholders for later: `APPLE_ID`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `KEYGEN_API_KEY`, `GH_TOKEN` (for updater feed)

## Phase 12 — Testing strategy (cross-cutting)

- [ ] Vitest + `@vitest/coverage-v8` wired at workspace root
- [ ] Playwright for Electron E2E wired
- [ ] Unit tests colocate as `*.test.ts`
- [ ] E2E at `tests/e2e/*.spec.ts`; fixtures in `tests/fixtures/`
- [ ] Coverage thresholds: ≥80% line overall; 100% on rules engine / diff classifier / license verify
- [ ] Mocking: `memfs` for fs; `msw/node` for HTTP
- [ ] E2E scenarios: coloring · Copy L→R · exclude `*.log` · text-diff edit+save · mocked updater dialog

---

## Verification (final gates)

- [ ] `just dev` launches app with HMR on Windows/macOS/Linux
- [ ] All Vitest suites pass with coverage ≥ threshold
- [ ] Playwright E2E passes on CI matrix
- [ ] Manual smoke: 10k-file pair thorough compare without UI freeze; 500 MB hex stream without OOM; image diff highlights known delta
- [ ] `just package` produces installer on each OS
- [ ] Publish `v0.0.1` then `v0.0.2` on GitHub Releases → installed v0.0.1 auto-updates
- [ ] Licensing: trial banner · invalid key rejected · valid key activates · revoked key → read-only within re-check window
- [ ] `awapi-compare ./a ./b` opens app with session pre-loaded

## Decisions (locked)

- Stack: Electron + React + TypeScript via `electron-vite`; pnpm workspaces
- Diff engine: Monaco `DiffEditor` (text), custom hex view, `pixelmatch` (image)
- License: proprietary EULA + 14-day in-app trial + paid activation; **LemonSqueezy** (storefront, merchant-of-record) + **Keygen.sh** (key issuance/validation)
- Auto-update: `electron-updater` → GitHub Releases of private repo `awapi/awapi-compare` with `GH_TOKEN`
- Signing: skipped v1; hooks stubbed
- Build tool: `just`
- Layout: source under `src/`, docs under `docs/`, persistent plan under `todo/plan.md`
- v1 scope: folder compare · text/binary/image file compare · copy L↔R · wildcard rules · inline edit · session save/load · CLI
- Deferred: SFTP (v1.1) · 3-way merge · archive compare · cloud storage · FTP/FTPS · content-regex rules
