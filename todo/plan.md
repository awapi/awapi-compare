# AwapiCompare — Plan

> **Source of truth for outstanding work.** Read [`todo/README.md`](./README.md) for the workflow.
> Only tick a checkbox when the change is merged to `main`.
>
> **Style rule:** items in this file describe **outcomes** — what the
> product or repo gains — not how to implement them. No library names,
> file paths, function signatures, or constants. Implementation
> rationale belongs in `docs/` (architecture, ADRs, etc.).

Build **AwapiCompare**, a cross-platform (Windows / macOS / Linux) Beyond
Compare alternative by Awapi. Folder and file compare, copy left ↔ right,
include/exclude rules, inline edit, binary/hex view, image diff, session
save/load, CLI entry. Proprietary license, in-app 14-day trial + paid
activation, auto-updates from a private GitHub Releases feed. Unsigned v1.

---

## Done (Phases 0 – 7)

The foundation is complete. See `git log` and `docs/` for detail.

- [x] **Phase 0** — Persistent plan workflow (`todo/`)
- [x] **Phase 1** — Repo scaffolding, workspace layout, tooling, license docs
- [x] **Phase 2** — Copilot instructions, issue/PR templates, doc skeletons
- [x] **Phase 3** — Electron shell with hardened security boundary and typed IPC surface
- [x] **Phase 4** — Folder compare engine (quick / thorough / binary modes; classifier; rule-aware scan)
- [x] **Phase 5** — Renderer UI (twin virtualized tree, theming, hotkeys, tabbed workspace, session store)
- [x] **Phase 6** — Wildcard include/exclude rules engine + rules editor + docs
- [x] **Phase 6.1** — Beyond-Compare-style "Simple" rules view (four-box layout) with lossless round-trip to Advanced
- [x] **Phase 6.5** — Per-session diff options (match attributes, pairing policy, content comparison) with a dedicated dialog
- [x] **Phase 7** — File compare views: text diff with inline edit, binary/hex view, image diff

---

## Phase 8 — Licensing, trial, activation

- [ ] First launch installs an anonymous install ID and starts a 14-day trial
- [ ] EULA shown on first launch; acceptance persisted
- [ ] Pluggable activation provider; default provider issues signed license tokens
- [ ] License key entry flow: validates with provider, stores credentials securely
- [ ] Offline launch verifies the stored license; periodic online re-check
- [ ] Expired / invalid / revoked licenses drop the app into read-only mode with clear messaging
- [ ] Storefront → license-issuer webhook flow documented for operators
- [ ] Tested end-to-end against a mocked license backend

## Phase 9 — Packaging, auto-update, task runner

- [x] Installers configured for Windows (NSIS `.exe` + `.msi`), macOS (`.dmg` + `.zip`), Linux (`.AppImage` + `.deb`); both x64 and arm64
- [x] Releases published to a private GitHub Releases feed
- [x] Code-signing hooks stubbed; first-launch OS warnings documented for users
- [x] Task-runner recipes for the full developer workflow (install, dev, lint, format, typecheck, test, e2e, build, package, release, regenerate notices, run CLI)
- [ ] App checks for updates on launch and from a menu item, downloads in the background, prompts to restart

## Phase 10 — Command-line entry

- [ ] `awapi-compare <left> <right>` opens the app pre-loaded with that folder pair
- [ ] Compare mode and rules file selectable via flags
- [ ] If the app is already running, the CLI hands off to the existing instance instead of launching a duplicate
- [ ] Installer integrates the CLI with the platform's PATH (with an opt-in step on macOS/Linux)

## Phase 11 — Release engineering (CI/CD)

- [x] Pull-request CI: lint, typecheck, unit tests, build on all three OSes
- [x] Tag-triggered release pipeline: build and publish installers for all three OSes to GitHub Releases
- [x] Secret slots reserved for future code-signing and license-backend credentials

## Phase 12 — Testing strategy (cross-cutting)

- [ ] Coverage thresholds enforced: ≥ 80% overall; 100% on rules engine, diff classifier, license verification, and trial evaluation
- [ ] Pure logic remains testable without launching Electron
- [ ] End-to-end suite covers the headline user flows: status coloring, copy left ↔ right, exclude rules, text edit & save, mocked auto-update dialog
- [ ] Filesystem and HTTP boundaries are mockable via dependency injection

---

## Verification (final gates before v1.0)

- [ ] `just dev` launches the app with hot reload on Windows, macOS, and Linux
- [ ] All unit and end-to-end tests pass with coverage above the configured thresholds
- [ ] Manual smoke: 10k-file pair thorough compare without UI freeze; 500 MB file in hex view without out-of-memory; image diff highlights known deltas
- [ ] `just package` produces installers on each host OS
- [ ] Auto-update verified end-to-end: a previous version installed locally upgrades to a newer published release
- [ ] Licensing verified end-to-end: trial banner during trial; invalid key rejected; valid key activates; revoked key forces read-only within the re-check window
- [ ] CLI verified: launching with two folder paths opens the app with that session pre-loaded

---

## Decisions (locked)

- **Stack:** Electron + React + TypeScript; pnpm workspaces
- **License model:** proprietary EULA + 14-day in-app trial + paid activation
- **Storefront / licensing backend:** LemonSqueezy (merchant-of-record) + Keygen.sh (key issuance & validation)
- **Auto-update channel:** GitHub Releases on a private repository
- **Code signing:** deferred past v1; hooks reserved
- **Task runner:** `just`
- **Source layout:** all code under `src/`; all docs under `docs/`; persistent plan under `todo/`

## v1 scope

Folder compare · text / binary / image file compare · copy left ↔ right ·
wildcard include/exclude rules · inline edit · session save and load · CLI.

## Deferred to post-v1

SFTP (v1.1) · 3-way merge · archive (zip/tar) compare · cloud-storage
backends · FTP/FTPS · content-regex rules.
