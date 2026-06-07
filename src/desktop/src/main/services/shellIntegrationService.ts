import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ExecFn = (cmd: string, args: string[]) => Promise<unknown>;

/**
 * Manages Windows Explorer context menu registration for AwapiCompare.
 *
 * Writes per-user (HKCU) registry keys via PowerShell — no elevation required.
 *
 * Pass a custom `execFn` to replace `child_process.execFile` in tests.
 */
export class ShellIntegrationService {
  private execFn: ExecFn;

  constructor(_userDataPath: string, execFn?: ExecFn) {
    this.execFn = execFn ?? ((cmd, args) => execFileAsync(cmd, args));
  }

  /**
   * Registers Windows Explorer context menu entries for AwapiCompare.
   * Only supported on Windows; throws on other platforms.
   */
  async register(exePath: string): Promise<void> {
    if (process.platform === 'win32') {
      await this.runPs(buildRegisterScript(exePath));
      return;
    }
    throw new Error('Shell integration is only supported on Windows');
  }

  /**
   * Removes context menu entries registered by {@link register}.
   * Safe to call when entries do not exist (no-op).
   */
  async unregister(): Promise<void> {
    if (process.platform === 'win32') {
      await this.runPs(buildUnregisterScript());
    }
  }

  /**
   * Returns `true` when Windows Explorer context menu entries are installed.
   * Always `false` on non-Windows platforms.
   *
   * Checks for the COM CLSID key as the authoritative indicator of the
   * current-generation registration (which includes both registry verbs and
   * the shell extension DLL).  An old-style installation that only has the
   * verb keys (no CLSID) will return `false`, causing a re-registration that
   * upgrades it to the full COM-based setup.
   */
  async isRegistered(): Promise<boolean> {
    if (process.platform === 'win32') {
      try {
        await this.execFn('reg', [
          'query',
          `HKCU\\Software\\Classes\\CLSID\\${SHELLEX_CLSID}\\InprocServer32`,
        ]);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // ---- PowerShell helpers ------------------------------------------------

  private async runPs(script: string): Promise<void> {
    await this.execFn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
  }
}

// ---------------------------------------------------------------------------
// PowerShell script builders — exported for unit testing.
// ---------------------------------------------------------------------------

/// CLSID for `awapi_shellex.dll` — must match the constant in `src/shellex/src/lib.rs`.
export const SHELLEX_CLSID = '{6814CA76-731B-41EC-948C-C320FB503A35}';

/**
 * Builds the PowerShell script that registers Windows Explorer context menu
 * entries. Exported so tests can verify the script structure without running
 * PowerShell.
 *
 * Registration has two layers:
 *
 * 1. **Registry verbs** (`shell\AwapiCompareSetLeft` / `AwapiCompareDoCompare`)
 *    with `MultiSelectModel=Single` — shown only when ONE item is selected.
 *    These implement the "select left → compare pending" two-click flow.
 *
 * 2. **COM shell extension** (`awapi_shellex.dll`) — shown when exactly TWO
 *    compatible items (both files or both directories) are selected.  Adds a
 *    single "Compare with AwapiCompare" item that passes both paths directly
 *    via `--left` / `--right`.  The COM registration is skipped silently when
 *    the DLL file does not exist (e.g. in dev / CI environments).
 */
export function buildRegisterScript(exePath: string): string {
  // Escape single quotes for use inside a PowerShell single-quoted string.
  // Windows paths cannot contain single quotes, but guard anyway.
  const psExe = exePath.replace(/'/g, "''");

  return [
    "$exe = '" + psExe + "'",
    // ---- 1. Store EXE path for the COM DLL to read at invocation time ----
    "New-Item -Path 'HKCU:\\Software\\AwapiCompare' -Force | Out-Null",
    "Set-ItemProperty -Path 'HKCU:\\Software\\AwapiCompare' -Name 'ExePath' -Value $exe",
    // ---- 2. Single-selection registry verbs --------------------------------
    // These show only when ONE item is right-clicked (MultiSelectModel=Single).
    '$roots = @(' +
      "'HKCU:\\Software\\Classes\\Directory\\shell'," +
      "'HKCU:\\Software\\Classes\\*\\shell'" +
      ')',
    '$verbs = @(',
    "  @{ Key='AwapiCompareSetLeft';   Label='Select Left Side for AwapiCompare'; Flag='--set-left' },",
    "  @{ Key='AwapiCompareDoCompare'; Label='Compare with AwapiCompare';        Flag='--compare-pending' }",
    ')',
    'foreach ($root in $roots) {',
    '  foreach ($v in $verbs) {',
    "    $k = \"$root\\$($v.Key)\"",
    '    New-Item -Path $k -Force | Out-Null',
    "    Set-ItemProperty -Path $k -Name '(default)'         -Value $v.Label",
    "    Set-ItemProperty -Path $k -Name 'Icon'              -Value ('\"' + $exe + '\",0')",
    // MultiSelectModel=Single: hide this verb when 2+ items are selected.
    // The COM extension handles multi-select instead.
    "    Set-ItemProperty -Path $k -Name 'MultiSelectModel'  -Value 'Single'",
    '    New-Item -Path "$k\\command" -Force | Out-Null',
    "    Set-ItemProperty -Path \"$k\\command\" -Name '(default)' -Value ('\"' + $exe + '\" ' + $v.Flag + ' \"%1\"')",
    '  }',
    '}',
    // ---- 3. COM shell extension (multi-select) ----------------------------
    // Register awapi_shellex.dll only when it exists next to the EXE.
    "$dllPath = Join-Path (Split-Path $exe -Parent) 'awapi_shellex.dll'",
    'if (Test-Path $dllPath) {',
    "  $clsid = '" + SHELLEX_CLSID + "'",
    "  $clsidKey = \"HKCU:\\Software\\Classes\\CLSID\\$clsid\"",
    '  New-Item -Path "$clsidKey\\InprocServer32" -Force | Out-Null',
    "  Set-ItemProperty -Path \"$clsidKey\\InprocServer32\" -Name '(default)'       -Value $dllPath",
    "  Set-ItemProperty -Path \"$clsidKey\\InprocServer32\" -Name 'ThreadingModel'  -Value 'Apartment'",
    // Register the extension under file (*) and directory context menus.
    "  foreach ($ext in @('*', 'Directory', 'Directory\\Background')) {",
    "    $hKey = \"HKCU:\\Software\\Classes\\$ext\\shellex\\ContextMenuHandlers\\AwapiCompare\"",
    '    New-Item -Path $hKey -Force | Out-Null',
    "    Set-ItemProperty -Path $hKey -Name '(default)' -Value $clsid",
    '  }',
    '}',
    // ---- 4. Send To shortcut (legacy fallback / convenience) ---------------
    '$sendTo = [Environment]::GetFolderPath("SendTo")',
    '$ws = New-Object -ComObject WScript.Shell',
    '$sc = $ws.CreateShortcut("$sendTo\\AwapiCompare.lnk")',
    '$sc.TargetPath = $exe',
    '$sc.IconLocation = "$exe,0"',
    '$sc.Save()',
  ].join('\n');
}

/** Builds the PowerShell script that removes all registered context menu entries. */
export function buildUnregisterScript(): string {
  const clsid = SHELLEX_CLSID;
  // Registry verb keys (current flat layout + legacy cascading layout).
  const verbPaths = [
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompareSetLeft',
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompareDoCompare',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareSetLeft',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareDoCompare',
    // Legacy cascading keys (pre-flat layout):
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare',
  ];
  const removeVerbs = verbPaths
    .map((p) => "Remove-Item -Path '" + p + "' -Recurse -Force -ErrorAction SilentlyContinue")
    .join('\n');

  // COM shell extension keys.
  const removeCom = [
    // CLSID registration
    `Remove-Item -Path 'HKCU:\\Software\\Classes\\CLSID\\${clsid}' -Recurse -Force -ErrorAction SilentlyContinue`,
    // ContextMenuHandlers entries
    `Remove-Item -Path 'HKCU:\\Software\\Classes\\*\\shellex\\ContextMenuHandlers\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\shellex\\ContextMenuHandlers\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\Background\\shellex\\ContextMenuHandlers\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue`,
    // Stored EXE path
    `Remove-Item -Path 'HKCU:\\Software\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue`,
  ].join('\n');

  return (
    removeVerbs +
    '\n' +
    removeCom +
    '\n$sendTo = [Environment]::GetFolderPath("SendTo")' +
    '\nRemove-Item -Path "$sendTo\\AwapiCompare.lnk" -Force -ErrorAction SilentlyContinue'
  );
}
