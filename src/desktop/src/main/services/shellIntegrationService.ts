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
   * Checks the `ShellIntegrationVersion` marker that {@link register} writes
   * as its last step. Older installs (registry verbs / COM handler only, no
   * Windows 11 sparse package) lack the marker or carry an older value, so
   * they return `false` and get re-registered on the next launch.
   */
  async isRegistered(): Promise<boolean> {
    if (process.platform === 'win32') {
      try {
        const result = (await this.execFn('reg', [
          'query',
          'HKCU\\Software\\AwapiCompare',
          '/v',
          'ShellIntegrationVersion',
        ])) as { stdout?: string } | undefined;
        const match = /ShellIntegrationVersion\s+REG_SZ\s+(\S+)/.exec(result?.stdout ?? '');
        return match?.[1] === SHELL_INTEGRATION_VERSION;
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

/// CLSID of the Windows 11 `IExplorerCommand` handler in `awapi_shellex.dll` —
/// must match `CLSID_AWAPI_EXPLORER_COMMAND` in `src/shellex/src/lib.rs` and the
/// Clsid values in `resources/msix/AppxManifest.template.xml`.
export const SHELLEX_EXPLORER_COMMAND_CLSID = '{EA2B6EB9-EDC9-4804-8086-9138D268CE9A}';

/// Identity name of the sparse MSIX package (`resources/msix/AppxManifest.template.xml`).
export const SPARSE_PACKAGE_NAME = 'Awapi.AwapiCompare';

/// Bump whenever the registration layout changes so existing installs re-register.
/// 2 = adds the Windows 11 sparse package (modern context menu).
export const SHELL_INTEGRATION_VERSION = '2';

/**
 * Builds the PowerShell script that registers Windows Explorer context menu
 * entries. Exported so tests can verify the script structure without running
 * PowerShell.
 *
 * Registration has three layers:
 *
 * 1. **Registry verbs** (`shell\AwapiCompareSetLeft` / `AwapiCompareDoCompare`)
 *    with `MultiSelectModel=Single` — shown only when ONE item is selected.
 *    These implement the "select left → compare pending" two-click flow.
 *
 * 2. **COM shell extension** (`shellex\<arch>\awapi_shellex.dll`, native arch) — shown when exactly TWO
 *    compatible items (both files or both directories) are selected.  Adds a
 *    single "Compare with AwapiCompare" item that passes both paths directly
 *    via `--left` / `--right`.  The COM registration is skipped silently when
 *    the DLL file does not exist (e.g. in dev / CI environments).
 *
 * 3. **Windows 11 sparse package** (`awapi_shellex.msix`) — the only way to
 *    appear in the modern (compact) right-click menu; layers 1 and 2 are only
 *    visible under "Show more options" there. The package carries no
 *    binaries: `-ExternalLocation` points it at the install directory, and its
 *    `IExplorerCommand` handler (also in `awapi_shellex.dll`) shows a Beyond
 *    Compare-style "AwapiCompare" flyout. Skipped on Windows 10 and when the
 *    .msix is absent; failures only warn so layers 1 and 2 still apply.
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
    // Both arches ship under <appDir>\shellex\<arch>\. Explorer only loads a
    // DLL of its own architecture, and an x64 build may run emulated on ARM64,
    // so pick by the OS's native arch rather than this process's.
    '$appDir = Split-Path $exe -Parent',
    "$nativeArch = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment').PROCESSOR_ARCHITECTURE",
    "$arch = if ($nativeArch -eq 'ARM64') { 'arm64' } else { 'x64' }",
    '$shellexDir = Join-Path $appDir "shellex\\$arch"',
    // Register awapi_shellex.dll only when it exists (absent in dev / CI).
    "$dllPath = Join-Path $shellexDir 'awapi_shellex.dll'",
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
    // ---- 5. Windows 11 sparse package (modern context menu) ---------------
    "$msix = Join-Path $shellexDir 'awapi_shellex.msix'",
    'if ((Test-Path $msix) -and [Environment]::OSVersion.Version.Build -ge 22000) {',
    '  try {',
    // Remove any previous registration first: it may point at an older
    // install directory, and Add-AppxPackage no-ops on an equal version.
    "    Get-AppxPackage -Name '" + SPARSE_PACKAGE_NAME + "' | Remove-AppxPackage -ErrorAction SilentlyContinue",
    '    Add-AppxPackage -Path $msix -ExternalLocation $appDir -AllowUnsigned -ErrorAction Stop',
    '  } catch {',
    '    Write-Warning "AwapiCompare: sparse package registration failed: $_"',
    '  }',
    '}',
    // ---- 6. Completion marker read by isRegistered() -----------------------
    "Set-ItemProperty -Path 'HKCU:\\Software\\AwapiCompare' -Name 'ShellIntegrationVersion' -Value '" +
      SHELL_INTEGRATION_VERSION +
      "'",
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
    '\nRemove-Item -Path "$sendTo\\AwapiCompare.lnk" -Force -ErrorAction SilentlyContinue' +
    "\nGet-AppxPackage -Name '" +
    SPARSE_PACKAGE_NAME +
    "' | Remove-AppxPackage -ErrorAction SilentlyContinue"
  );
}
