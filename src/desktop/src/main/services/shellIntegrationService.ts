import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

type FsPromiseLike = {
  writeFile: (path: string, data: string) => Promise<void>;
  readFile: (path: string, encoding: 'utf-8') => Promise<string>;
  unlink: (path: string) => Promise<void>;
};

const execFileAsync = promisify(execFile);

type ExecFn = (cmd: string, args: string[]) => Promise<unknown>;

/**
 * Manages Windows Explorer context menu registration for AwapiCompare
 * and the pending-left-file workflow used by the two-step
 * "Select Left → Compare" Explorer verbs.
 *
 * Writes per-user (HKCU) registry keys via PowerShell — no elevation required.
 *
 * Pass custom `execFn` and `fsLike` to replace real implementations in tests.
 */
export class ShellIntegrationService {
  private execFn: ExecFn;
  private fsLike: FsPromiseLike;
  private pendingLeftPath: string;

  constructor(userDataPath: string, execFn?: ExecFn, fsLike?: FsPromiseLike) {
    this.execFn = execFn ?? ((cmd, args) => execFileAsync(cmd, args));
    this.fsLike = fsLike ?? fsp;
    this.pendingLeftPath = join(userDataPath, 'pending-left.txt');
  }

  // ---- Pending-left workflow ------------------------------------------

  /** Write the path selected as "left side" to a known file. */
  async setPendingLeft(path: string): Promise<void> {
    await this.fsLike.writeFile(this.pendingLeftPath, path + '\n');
  }

  /** Read the currently stashed left-side path, or `null` if unset. */
  async getPendingLeft(): Promise<string | null> {
    try {
      const raw = await this.fsLike.readFile(this.pendingLeftPath, 'utf-8');
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /** Remove the stashed left-side path. */
  async clearPendingLeft(): Promise<void> {
    try {
      await this.fsLike.unlink(this.pendingLeftPath);
    } catch {
      // file already gone — fine
    }
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
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\AwapiCompare.CompareTwo',
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
    "$cmdStore = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell'",
    "$idSetLeft = 'AwapiCompare.SelectLeft'",
    "$idComparePending = 'AwapiCompare.ComparePending'",
    "$idCompareTwo = 'AwapiCompare.CompareTwo'",
    '$subCommands = "$idSetLeft;$idComparePending;$idCompareTwo"',
    '$targets = @(' +
      "'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare'," +
      "'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare'" +
      ')',
    'foreach ($t in $targets) {',
    '  New-Item -Path $t -Force | Out-Null',
    "  Set-ItemProperty -Path $t -Name '(default)' -Value 'AwapiCompare'",
    "  Set-ItemProperty -Path $t -Name 'MUIVerb' -Value 'AwapiCompare'",
    "  Set-ItemProperty -Path $t -Name 'SubCommands' -Value $subCommands",
    "  Set-ItemProperty -Path $t -Name 'MultiSelectModel' -Value 'Player'",
    "  Set-ItemProperty -Path $t -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    '}',
    '$kSetLeft = "$cmdStore\\$idSetLeft"',
    'New-Item -Path $kSetLeft -Force | Out-Null',
    "Set-ItemProperty -Path $kSetLeft -Name '(default)' -Value 'Select as Left Side'",
    "Set-ItemProperty -Path $kSetLeft -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    'New-Item -Path "$kSetLeft\\command" -Force | Out-Null',
    "Set-ItemProperty -Path \"$kSetLeft\\command\" -Name '(default)' -Value ('\"' + $exe + '\" --set-left \"%1\"')",
    '$kComparePending = "$cmdStore\\$idComparePending"',
    'New-Item -Path $kComparePending -Force | Out-Null',
    "Set-ItemProperty -Path $kComparePending -Name '(default)' -Value 'Compare to Pending Left'",
    "Set-ItemProperty -Path $kComparePending -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    'New-Item -Path "$kComparePending\\command" -Force | Out-Null',
    "Set-ItemProperty -Path \"$kComparePending\\command\" -Name '(default)' -Value ('\"' + $exe + '\" --compare-pending \"%1\"')",
    '$kCompareTwo = "$cmdStore\\$idCompareTwo"',
    'New-Item -Path $kCompareTwo -Force | Out-Null',
    "Set-ItemProperty -Path $kCompareTwo -Name '(default)' -Value 'Compare with AwapiCompare'",
    "Set-ItemProperty -Path $kCompareTwo -Name 'Icon' -Value ('\"' + $exe + '\",0')",
    "Set-ItemProperty -Path $kCompareTwo -Name 'MultiSelectModel' -Value 'Player'",
    'New-Item -Path "$kCompareTwo\\command" -Force | Out-Null',
    "Set-ItemProperty -Path \"$kCompareTwo\\command\" -Name '(default)' -Value ('\"' + $exe + '\" --compare-two %V')",
  ].join('\n');
}

/** Builds the PowerShell script that removes all registered context menu entries. */
export function buildUnregisterScript(): string {
  return [
    "Remove-Item -Path 'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -Path 'HKCU:\\Software\\Classes\\Directory\\shell\\AwapiCompare' -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\AwapiCompare.SelectLeft' -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\AwapiCompare.ComparePending' -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\AwapiCompare.CompareTwo' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}
