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
   */
  async isRegistered(): Promise<boolean> {
    if (process.platform === 'win32') {
      try {
        await this.execFn('reg', [
          'query',
          'HKCU\\Software\\Classes\\Directory\\shell\\AwapiCompareDoCompare',
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

/**
 * Builds the PowerShell script that registers Windows Explorer context menu
 * entries. Exported so tests can verify the script structure without running
 * PowerShell.
 */
export function buildRegisterScript(exePath: string): string {
  // Escape single quotes for use inside a PowerShell single-quoted string.
  // Windows paths cannot contain single quotes, but guard anyway.
  const psExe = exePath.replace(/'/g, "''");

  // Two FLAT top-level HKCU verbs — no cascading submenu. This is the only
  // layout that reliably renders in both the legacy Win10 menu and the
  // Win11 modern menu without "Show more options". Cascading via
  // SubCommands/ExtendedSubCommandsKey is finicky and silently hides the
  // entire entry when misconfigured.
  //
  // Verbs written under HKCU:\Software\Classes\{Directory,*}\shell\:
  //   AwapiCompareSetLeft   → label "Select Left Side for AwapiCompare"
  //                            command: "<exe>" --set-left "%1"
  //   AwapiCompareDoCompare → label "Compare with AwapiCompare"
  //                            command: "<exe>" --compare-pending "%1"
  return [
    "$exe = '" + psExe + "'",
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
    "    Set-ItemProperty -Path $k -Name '(default)' -Value $v.Label",
    "    Set-ItemProperty -Path $k -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    '    New-Item -Path "$k\\command" -Force | Out-Null',
    "    Set-ItemProperty -Path \"$k\\command\" -Name '(default)' -Value ('\"' + $exe + '\" ' + $v.Flag + ' \"%1\"')",
    '  }',
    '}',
    // SendTo shortcut — lets the user select 2 folders, Send to → AwapiCompare.
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
  // Remove both new (flat) and legacy (cascading) keys so an upgrade from a
  // version that wrote the cascading layout cleans up properly.
  const paths = [
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompareSetLeft',
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompareDoCompare',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareSetLeft',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareDoCompare',
    // Legacy cascading keys (pre-flat layout):
    'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare',
    'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare',
  ];
  return paths
    .map((p) => "Remove-Item -Path '" + p + "' -Recurse -Force -ErrorAction SilentlyContinue")
    .join('\n') +
    // Also remove the SendTo shortcut.
    '\n$sendTo = [Environment]::GetFolderPath("SendTo")' +
    '\nRemove-Item -Path "$sendTo\\AwapiCompare.lnk" -Force -ErrorAction SilentlyContinue';
}
