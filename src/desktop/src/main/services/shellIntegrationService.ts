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
          'HKCU\\Software\\Classes\\Directory\\shell\\AwapiCompare',
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

  // We set $exe from a single-quoted (unexpanded) string, then reference it
  // inside double-quoted strings where PS expands it. This avoids backtick
  // escaping and is safe against paths that contain $, `, etc.
  //
  // Registry values written:
  //   Icon    →  "<exe>",0
  //   command →  "<exe>" --set-left "%1"   (or --compare-pending)
  // The %1 is an Explorer placeholder expanded at invocation time.
  return [
    "$exe = '" + psExe + "'",
    '$targets = @(' +
      "'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare'," +
      "'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare'" +
      ')',
    'foreach ($t in $targets) {',
    '  New-Item -Path $t -Force | Out-Null',
    "  Set-ItemProperty -Path $t -Name '(default)' -Value 'AwapiCompare'",
    "  Set-ItemProperty -Path $t -Name 'MUIVerb' -Value 'AwapiCompare'",
    "  Set-ItemProperty -Path $t -Name 'SubCommands' -Value ''",
    "  Set-ItemProperty -Path $t -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    '  $s = "$t\\shell"',
    '  $k1 = "$s\\01.SetLeft"',
    '  New-Item -Path $k1 -Force | Out-Null',
    "  Set-ItemProperty -Path $k1 -Name '(default)' -Value 'Select as Left Side'",
    '  New-Item -Path "$k1\\command" -Force | Out-Null',
    "  Set-ItemProperty -Path \"$k1\\command\" -Name '(default)' -Value ('\"' + $exe + '\" --set-left \"%1\"')",
    '  $k2 = "$s\\02.Compare"',
    '  New-Item -Path $k2 -Force | Out-Null',
    "  Set-ItemProperty -Path $k2 -Name '(default)' -Value 'Compare with AwapiCompare'",
    '  New-Item -Path "$k2\\command" -Force | Out-Null',
    "  Set-ItemProperty -Path \"$k2\\command\" -Name '(default)' -Value ('\"' + $exe + '\" --compare-pending \"%1\"')",
    '}',
  ].join('\n');
}

/** Builds the PowerShell script that removes all registered context menu entries. */
export function buildUnregisterScript(): string {
  return [
    "Remove-Item -Path 'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}
