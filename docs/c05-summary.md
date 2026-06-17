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

## Current State
- `--compare-two <left> <right>` CLI flag is parsed and wired end-to-end.
- Explorer registration uses CommandStore + `MultiSelectModel="Player"` and can dispatch `--compare-two`.
- Existing typecheck and focused unit tests pass on this branch.
- The native COM handler is still missing; modern Win11 compact menu + dynamic labels are not complete until COM work is done on Windows.

## Remaining Work
1. Build native Windows COM handler implementing `IExplorerCommand` (Rust or C++), including dynamic title behavior for pending-left.
2. Register `ExplorerCommandHandler` CLSID for the relevant CommandStore verbs.
3. Validate in Windows Explorer (especially Win11 compact menu behavior, multi-select, and fallback behavior).
4. Keep C0.5 unchecked in `todo/shell-integration.md` until COM portion is complete and merged.
