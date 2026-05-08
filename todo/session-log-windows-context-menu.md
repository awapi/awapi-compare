# Session Log — Windows Explorer Context Menu Integration

> Hand-off document for continuing work on the Windows Explorer context menu
> feature in a new chat session. Reference this file in the new session.

---

## Goal

Add Beyond-Compare-style right-click menu in Windows Explorer:

1. Right-click folder → **"Select Left Side for AwapiCompare"** (stores pick).
2. Right-click another folder → **"Compare with AwapiCompare"** (opens diff
   with stored left side).

Branding requirement: must NOT use Beyond Compare's exact verb names.

---

## Current State

- ✅ CLI parsing for `--set-left` and `--compare-pending` implemented and unit
  tested (25/25 passing).
- ✅ Pending-pick storage in `%APPDATA%\AwapiCompare\shell-pick.json`.
- ✅ Auto-register on Windows first launch (idempotent) — kept as a fallback.
- ✅ HKCU registry writes via PowerShell (no admin, no Explorer restart needed).
- ✅ Shell integration service tests passing (20/20).
- ✅ TypeScript typecheck clean.
- ✅ `just package` works on Windows — produces `release/AwapiCompare-0.2.1-arm64-setup.exe`
  (and matching `.msi`).
- ✅ **Fix attempt #1 (this session)**: switched from a misconfigured cascading
  submenu (`MUIVerb` + empty `SubCommands` + `\shell\01.SetLeft` children) to
  TWO flat top-level HKCU verbs:
  - `Software\Classes\Directory\shell\AwapiCompareSetLeft`
  - `Software\Classes\Directory\shell\AwapiCompareDoCompare`
  - (and the `*\shell\…` mirror keys for files)
  Flat verbs render reliably in both the legacy Win10 menu and the Win11
  modern menu without requiring "Show more options".
- ✅ **Fix attempt #2 (this session)**: `resources/installer.nsh` now writes
  the same verbs natively from NSIS at install time, so right-click works
  immediately after install — no need to launch the app first, no PowerShell
  dependency. Uninstall removes both the new flat keys and any legacy
  cascading keys for clean upgrades.
- ⏳ **Next: rebuild installer and verify on the user's machine.** Run
  `just package win`, install the new `release/AwapiCompare-*-setup.exe`,
  then check: (a) `reg query "HKCU\Software\Classes\Directory\shell\AwapiCompareDoCompare"`
  should now return values immediately after install, and (b) right-click on
  a folder should show "Select Left Side for AwapiCompare" and
  "Compare with AwapiCompare".

---

## Files Touched

| File | Purpose |
|---|---|
| `src/desktop/src/main/cliArgs.ts` | Added `setLeft` / `comparePending` arg kinds and parser. |
| `src/desktop/src/main/cliArgs.test.ts` | New tests; uses `resolve('/work')` for cross-platform paths. |
| `src/desktop/src/main/index.ts` | Handles new arg kinds; auto-registers shell on Windows. |
| `src/desktop/src/main/services/shellIntegrationService.ts` | PowerShell-based HKCU registrar. |
| `src/desktop/src/main/services/shellIntegrationService.test.ts` | Branding test. |
| `justfile` | Fixed `--config ../../electron-builder.yml` for `package` recipe. |

---

## Design Choice

- Plain HKCU registry verbs only — **no COM DLL, no shell extension**.
- Per-user (no admin needed).
- Verbs spawn the same `AwapiCompare.exe` with CLI flags.
- Left pick persisted to JSON between invocations because Explorer does not
  keep the first invocation alive.

---

## Registry Layout Written

```text
HKCU\Software\Classes\Directory\shell\AwapiCompare
  (default) = "Compare with AwapiCompare"
  Icon      = "<path>\AwapiCompare.exe"
  \shell\01.SetLeft\command  = "<exe>" --set-left "%1"
  \shell\02.Compare\command  = "<exe>" --compare-pending "%1"

HKCU\Software\Classes\*\shell\AwapiCompare   (same structure, for files)
```

(Verb label "Select Left Side for AwapiCompare" — distinct from Beyond Compare.)

---

## Why The Menu Probably Isn't Showing — Most Likely Causes

1. **Win11 hides legacy verbs behind "Show more options" / Shift+Right-click.**
   Try Shift+Right-click on a folder first. If menu items appear there, the
   feature works — it's just a Win11 UX issue, not a bug.

2. **Auto-register only runs AFTER the app is launched at least once.**
   The installer does NOT write the registry. The user must launch
   `AwapiCompare.exe` once before right-clicking will work.

3. **Stale registry from a dev build** pointing to an exe path that no longer
   exists.

4. **PowerShell execution policy** could be silently blocking the registration
   script run by the main process.

---

## Diagnostics To Run In New Session

Open PowerShell on the user's machine and run, one block at a time. Save the
output to share with the new session.

### 1. Did the app actually register the verbs?

```powershell
reg query "HKCU\Software\Classes\Directory\shell\AwapiCompare" /s
reg query "HKCU\Software\Classes\*\shell\AwapiCompare" /s
```

Expected: tree with `01.SetLeft` and `02.Compare` subkeys, each with a
`command` containing the path to `AwapiCompare.exe`. If empty / "unable to
find", registration never ran.

### 2. Is the installed exe where we think?

```powershell
Get-ChildItem -Path "$env:LOCALAPPDATA\Programs\AwapiCompare","C:\Program Files\AwapiCompare" -Filter AwapiCompare.exe -Recurse -ErrorAction SilentlyContinue | Select-Object FullName
```

### 3. Force-register manually using the installed exe

If the app accepts `--register-shell` (it should — see `cliArgs.ts`):

```powershell
& "<full path to AwapiCompare.exe>" --register-shell
```

Wait ~5 seconds, then re-run step 1.

### 4. Right-click test

- First try: **Shift + Right-click** on a folder, look for "Compare with AwapiCompare".
- Then: regular right-click → "Show more options" (Win11) → look there.

### 5. If still missing, restart Explorer cleanly

```powershell
Stop-Process -Name explorer -Force
Start-Process explorer
```

### 6. Manual registry write (sanity check that any context menu works)

If the app's PowerShell registration fails, write the keys directly:

```powershell
$exe = "C:\Path\To\AwapiCompare.exe"   # adjust
$root = "HKCU:\Software\Classes\Directory\shell\AwapiCompareTest"
New-Item -Path $root -Force | Out-Null
Set-ItemProperty -Path $root -Name "(default)" -Value "AwapiCompare TEST"
New-Item -Path "$root\command" -Force | Out-Null
Set-ItemProperty -Path "$root\command" -Name "(default)" -Value "`"$exe`" --set-left `"%1`""
```

Then Shift+Right-click a folder. If "AwapiCompare TEST" appears, the
registry approach is sound and the issue is in the registration code path.

---

## Possible Better / Alternative Approaches

| Option | Pros | Cons |
|---|---|---|
| **Current: HKCU verbs (PowerShell at runtime)** | No admin, no DLL, instant | Hidden under "Show more options" on Win11 |
| Run shell registration from the NSIS installer (`resources/installer.nsh`) | Works immediately after install — no need to launch app first | Slightly more complex installer; HKLM needs admin, HKCU OK |
| Sparse-signed **MSIX** with `windows.fileExplorerContextMenus` | Appears in Win11 modern menu natively | Requires MSIX packaging + signing cert; bigger refactor |
| In-proc COM **IExplorerCommand** DLL | Modern menu, no MSIX | C++ DLL, admin install, restart of Explorer required |

**Recommended next step if the menu is missing:** add registration to the NSIS
installer (`resources/installer.nsh`) so the keys exist immediately after
install, even before the user launches the app. This sidesteps the
"register-on-first-launch" timing issue entirely.

---

## Open Questions To Answer In New Session

1. Did `reg query` show the AwapiCompare verbs? (yes/no)
2. Does Shift+Right-click reveal them? (yes/no)
3. Does manual `--register-shell` work?
4. Does writing a test key via raw `reg add` show up?
5. Should we move registration into the NSIS installer?

---

## Build & Test Quick Reference

- Repo root: `C:\projects\github.awapi\awapi-compare`
- Build installer: `just package` (or `just package win` for Windows only)
- Output: `release/AwapiCompare-0.2.1-arm64-setup.exe` (and `.msi`)
- Run unit tests: `pnpm run test`
- Just runs through cygwin bash on this machine; `--config` paths must be
  relative to `--projectDir src/desktop` (i.e. `../../electron-builder.yml`).

---

## Hand-off Instructions For New Session

Tell the new session:

> Read `todo/session-log-windows-context-menu.md`. The Windows Explorer
> context-menu integration is implemented but not appearing for the user
> after installing the latest installer. Run the diagnostics in section
> "Diagnostics To Run In New Session" with the user, then decide whether
> to (a) fix the runtime registration path or (b) move registration into
> the NSIS installer (`resources/installer.nsh`).
