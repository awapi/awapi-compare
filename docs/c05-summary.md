# C0.5 Implementation Summary — What Changed

## Goal

Implement multi-select support for Windows Explorer (pick 2 items → compare in one click) along with a COM `IExplorerCommand` handler for Windows 11 compact context menu and dynamic labels.

## Files Changed

### 1. `src/desktop/src/main/cliArgs.ts`

- ✅ Added `{ kind: 'compareTwo'; leftPath: string; rightPath: string }` to the `DesktopArgs` type.
- ✅ Added two local variables: `let compareTwoLeft` and `let compareTwoRight`.
- ✅ Added `--compare-two` argument parsing in the for-loop (both `--compare-two <left> <right>` and `--compare-two=<left>,<right>` forms).
- ✅ Added return block that returns `{ kind: 'compareTwo', leftPath, rightPath }` when both paths are set.
- ✅ Fixed explicit `--type=file` handling so it is preserved (was being accepted but effectively downgraded to folder before this fix).

### 2. `src/desktop/src/main/index.ts`

- ✅ Added `compareTwo` handling in the startup flow: when `args.kind === 'compareTwo'`, the two paths are converted into a `compare` session with `type: 'folder'` and fall through to the normal flow.
- ✅ Fixed strict type narrowing around parsed CLI args (`args.session` / `args.path`) so `pnpm typecheck` is green.

### 3. `src/desktop/src/main/services/shellIntegrationService.ts`

- ✅ Migrated registration from static nested verbs to Explorer `CommandStore` ids:
  - `AwapiCompare.SelectLeft`
  - `AwapiCompare.ComparePending`
  - `AwapiCompare.CompareTwo`
- ✅ Added `SubCommands` linking from `Classes\*|Directory\shell\AwapiCompare` to CommandStore ids.
- ✅ Added `MultiSelectModel="Player"` and `--compare-two %V` command wiring for multi-select launch.
- ✅ Updated `isRegistered()` probe to check CommandStore key.
- ✅ Expanded `buildUnregisterScript()` to clean both legacy and CommandStore keys.

### 4. `src/shared/src/ipc.ts`

- ✅ Updated `InitialCompareSession.type` to `'folder' | 'file'` so file comparisons from CLI/session bootstrap are typed correctly.

### 5. `src/desktop/src/main/cliArgs.test.ts`

- ✅ Added tests for:
  - `--compare-two <left> <right>`
  - `--compare-two=<left>,<right>`
  - missing second path validation
  - explicit `--type=file`

### 6. `src/desktop/src/main/services/shellIntegrationService.test.ts`

- ✅ Updated tests to assert CommandStore registration model (`CommandStore`, `MultiSelectModel`, `AwapiCompare.CompareTwo`, `--compare-two`).

### 7. `resources/installer.nsh`

- ✅ Extended uninstall cleanup to remove CommandStore keys (`AwapiCompare.SelectLeft`, `AwapiCompare.ComparePending`, `AwapiCompare.CompareTwo`) in addition to legacy class keys.
- ✅ Also removes the native handler CLSID keys and the `HKCU\Software\Awapi\AwapiCompare` config key.

### 8. `src/shell-ext-win/` (new — native COM handler)

- ✅ `src/dllmain.cpp` — in-process COM server implementing `IExplorerCommand`
  for all three verbs (`CompareTwo` / `SelectLeft` / `ComparePending`) plus
  `IClassFactory`, `DllGetClassObject`, `DllCanUnloadNow`, and
  `DllRegisterServer` / `DllUnregisterServer` (regsvr32 self-registration).
  - Multi-select: reads the full `IShellItemArray` (`GetState` shows
    `CompareTwo` only for exactly 2 items; single-item verbs for 1).
  - Dynamic label: `GetTitle` returns "Compare to <basename>" from the
    pending-left stash.
  - Robustness: hides every verb when the app exe is missing, so Explorer
    never breaks (falls back to the classic `command` verbs).
  - Config is read from `HKCU\Software\Awapi\AwapiCompare`
    (`ExePath` / `PendingLeftPath`).
- ✅ `src/guids.h` — stable CLSIDs shared with the TS registration.
- ✅ `CMakeLists.txt`, `AwapiCompareShellExt.def`, `README.md` — build setup.

### 9. `electron-builder.yml`

- ✅ `win.extraResources` bundles `AwapiCompareShellExt.dll` into
  `<appRoot>/resources/` (filter form — no-op when the DLL isn't built).

### 10. `justfile`

- ✅ Added a `shellext` recipe (CMake configure + Release build).

## Current State

- `--compare-two <left> <right>` CLI flag is parsed and wired end-to-end.
- Explorer registration uses CommandStore + `MultiSelectModel="Player"` and can dispatch `--compare-two`.
- The native `IExplorerCommand` handler is implemented in
  `src/shell-ext-win/` (multi-select, dynamic label, missing-app fallback) and
  the TS registration now binds each CommandStore verb to its CLSID via
  `ExplorerCommandHandler` (guarded by `Test-Path` on the DLL).
- Existing typecheck and focused unit tests pass on this branch.
- **Not yet validated at runtime:** this environment has no C++/MSVC/CMake
  toolchain, so the DLL has not been compiled or exercised in Explorer.

## Remaining Work

1. Build the handler on a Windows machine with MSVC + the Windows SDK + CMake
   (`just shellext`), then validate in Explorer: multi-select compare,
   Select-Left → Compare-to-<left> dynamic label, and missing-app fallback.
2. Windows 11 **compact** menu placement requires shipping the handler in a
   **signed** (sparse) MSIX package — code signing is currently disabled for
   v1 (`forceCodeSigning: false`), so this is deferred. Until then the verbs
   appear under "Show more options".
3. Keep C0.5 (and C1/C3) unchecked in `todo/shell-integration.md` until the
   native handler is built, signed-packaged, and validated on Windows.

## Windows Continuation Prompt (Copy/Paste)

Use this prompt in a new chat on a Windows machine:

```text
Continue C0.5 Windows shell integration work for awapi/awapi-compare.

Repository state:
- Branch: c0-5-windows-handoff
- Latest handoff commit: 683cfd1
- C0.5 is partially complete: CLI and CommandStore registration are done.

Already completed in this branch:
1) --compare-two CLI parsing and startup wiring in desktop main process
2) CommandStore-based shell registration with MultiSelectModel="Player"
3) Command cleanup in unregister and installer uninstall
4) Unit tests for cliArgs and shellIntegrationService updates

Still missing for true C0.5 completion:
1) Native COM IExplorerCommand handler implementation (Rust or C++)
2) ExplorerCommandHandler CLSID registration for CommandStore verbs
3) Windows Explorer runtime validation (Win11 compact menu + dynamic labels)

Task now:
- Implement the native COM handler and wire registry entries so:
	- Multi-select receives full IShellItemArray
	- Verbs appear directly in Win11 modern context menu
	- Dynamic label works for pending-left flow
- Keep existing CLI contract:
	- --set-left <path>
	- --compare-pending <path>
	- --compare-two <left> <right>

Acceptance criteria:
1) Right-click 2 selected items in Explorer opens compare in one click
2) Right-click single item supports Select Left then Compare to <left>
3) Entries show in Win11 compact menu (not only Show more options)
4) No Explorer crash if app missing/outdated
5) Update docs/c05-summary.md and todo/shell-integration.md status notes

Constraints:
- Follow repository rules in .github/copilot-instructions.md
- Do not mark C0.5 checkbox complete until COM part is implemented and validated
```
