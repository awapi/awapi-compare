# GitHub Copilot Instructions — AwapiCompare

These instructions apply to **every** Copilot / agent interaction in this
repository. Read them before proposing or executing changes.

## Project

**AwapiCompare** by **Awapi** — a cross-platform (Windows, macOS, Linux)
Beyond Compare alternative. Proprietary, commercial. 14-day in-app trial,
paid activation via LemonSqueezy + Keygen.sh, auto-updates via
`electron-updater` against a private GitHub Releases repo.

## Stack

- Electron + React + TypeScript, bundled with `electron-vite`
- pnpm workspaces (`src/*`)
- `just` task runner
- Vitest (unit + coverage) and Playwright (E2E)

## Persistent plan — READ FIRST

The canonical source of truth for outstanding work is
[`todo/plan.md`](../todo/plan.md). Workflow:

1. **Before starting any task**, open `todo/plan.md` and find the next
   unchecked item whose prerequisites are satisfied.
2. **After finishing a task**, tick (`- [x]`) its checkbox in the **same
   PR** that implements it.
3. **If scope changes**, update `todo/plan.md` in a dedicated `plan: ...`
   PR — never hide scope changes inside feature PRs.

The PR template includes a checklist item enforcing this rule.

## Repository layout (MUST be respected)

- **All source code** lives under `src/`. Never create source files at
  the repo root or under `apps/` / `packages/`.
- **All documentation** lives under `docs/`. Only the following markdown
  files may appear at the repo root: `README.md`, `LICENSE.md`,
  `EULA.md`, plus anything under `.github/` and `todo/`.
- **Unit tests** colocate with source as `*.test.ts` / `*.test.tsx`.
- **End-to-end tests** live in `tests/e2e/` with fixtures in `tests/fixtures/`.
- **Workspaces**: `src/desktop` (Electron app), `src/shared` (types + IPC),
  `src/licensing` (trial + activation), `src/cli` (CLI entry).

## Code style

- TypeScript strict mode; `noUncheckedIndexedAccess` is on.
- No `any` without written justification.
- ESM only (`"type": "module"` throughout).
- Prefer named exports over default exports.
- React function components with hooks. Zustand for renderer state. No
  class components.
- File names: `camelCase.ts` for modules, `PascalCase.tsx` for React
  components.

## Security rules (non-negotiable)

- `BrowserWindow` must use `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`.
- **The renderer never imports Node APIs.** All filesystem, OS, network,
  and credential operations live in the main process.
- All main ↔ renderer communication goes through the typed IPC surface
  defined in `src/shared/src/ipc.ts` and exposed via `contextBridge` in
  `src/desktop/src/preload/index.ts`.
- The Content Security Policy in `index.html` must remain restrictive
  (no `unsafe-eval`; no remote script sources).

## IPC workflow

When adding a new main ↔ renderer capability:

1. Add the channel id to `IpcChannel` in `src/shared/src/ipc.ts`.
2. Add typed request/response interfaces in the same file.
3. Extend the `AwapiApi` interface.
4. Implement the main-side handler as an injectable service in
   `src/desktop/src/main/services/`.
5. Wire it through the preload bridge.
6. Only then call it from the renderer.

## Testing expectations

- **Every new module requires unit tests.** PRs without tests will be
  rejected.
- Coverage thresholds enforced by Vitest: ≥80% lines overall; **100% on
  pure-logic modules** (rules engine, diff classifier, license verify,
  trial evaluator).
- Pure logic must be testable **without importing `electron`**.
- Services that touch the filesystem or HTTP must accept their
  dependencies via constructor/factory injection so tests can use
  `memfs` / `msw`.
- User-facing flows are covered by Playwright E2E in `tests/e2e/`.

## Commits & PRs

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`,
  `test:`, `refactor:`, `plan:`).
- Every PR must pass `just lint`, `just typecheck`, `just test` before
  review.
- Do not bypass Git hooks (`--no-verify` is forbidden).

## Dependencies

- **No GPL, AGPL, or SSPL-licensed dependencies.** The product is
  proprietary. Run `just notices` before adding a new dependency and
  verify its license is MIT / BSD / Apache-2.0 / ISC or similarly
  permissive.
- Prefer small, well-maintained packages over large frameworks.

## Files Copilot must NOT edit without explicit user request

- `LICENSE.md`
- `EULA.md`
- `electron-builder.yml` (the `publish:` block in particular)
- `.github/workflows/release.yml`
- Anything under `todo/` except ticking a checkbox that corresponds to
  a completed task in the same PR.

## When in doubt

Ask. Never guess about licensing, security boundaries, or the IPC
contract — they are the product's foundation.
