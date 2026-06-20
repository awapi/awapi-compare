import { describe, expect, it, vi } from 'vitest';

import {
  SHELL_EXT_CLSIDS,
  ShellIntegrationService,
  buildRegisterScript,
  buildUnregisterScript,
} from './shellIntegrationService.js';

// ---- helpers ---------------------------------------------------------------

function makeExec() {
  return vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
}

// ---- platform guards -------------------------------------------------------

describe('ShellIntegrationService — platform guards', () => {
  it('register() throws on unsupported platforms (non-win32)', async () => {
    if (process.platform !== 'win32') {
      const svc = new ShellIntegrationService('', makeExec());
      await expect(svc.register('/path/to/app')).rejects.toThrow(/Windows/);
    }
  });

  it('unregister() resolves without calling exec on non-win32', async () => {
    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);
    if (process.platform !== 'win32') {
      await expect(svc.unregister()).resolves.toBeUndefined();
      expect(exec).not.toHaveBeenCalled();
    }
  });

  it('isRegistered() returns false on non-win32 platforms', async () => {
    const svc = new ShellIntegrationService('', makeExec());
    if (process.platform !== 'win32') {
      expect(await svc.isRegistered()).toBe(false);
    }
  });

  it('getRegistrationScope() returns disabled on non-win32 platforms', async () => {
    const svc = new ShellIntegrationService('', makeExec());
    if (process.platform !== 'win32') {
      expect(await svc.getRegistrationScope()).toBe('disabled');
    }
  });
});

// ---- Windows exec calls (tested via injected exec) -------------------------

describe('ShellIntegrationService — exec interactions (win32 only)', () => {
  it('register() invokes powershell.exe with the correct flags', async () => {
    if (process.platform !== 'win32') return;

    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);
    await svc.register('C:\\Apps\\AwapiCompare.exe');

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('powershell.exe');
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    expect(args).toContain('Bypass');
    expect(args).toContain('-Command');
  });

  it('unregister() invokes powershell.exe on win32', async () => {
    if (process.platform !== 'win32') return;

    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);
    await svc.unregister();

    expect(exec).toHaveBeenCalledOnce();
    const [cmd] = exec.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('powershell.exe');
  });

  it('isRegistered() queries the registry key', async () => {
    if (process.platform !== 'win32') return;

    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);
    await svc.isRegistered();

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('reg');
    expect(args.some((a) => a.includes('CommandStore'))).toBe(true);
    expect(args.some((a) => a.includes('AwapiCompare.CompareTwo'))).toBe(true);
  });

  it('getRegistrationScope() returns per-user when HKCU key exists', async () => {
    if (process.platform !== 'win32') return;

    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);

    await expect(svc.getRegistrationScope()).resolves.toBe('per-user');
  });

  it('getRegistrationScope() returns per-machine when HKCU is missing and HKLM exists', async () => {
    if (process.platform !== 'win32') return;

    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('hkcu missing'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });
    const svc = new ShellIntegrationService('', exec);

    await expect(svc.getRegistrationScope()).resolves.toBe('per-machine');
  });

  it('getRegistrationScope() returns disabled when neither HKCU nor HKLM exists', async () => {
    if (process.platform !== 'win32') return;

    const exec = vi.fn().mockRejectedValue(new Error('missing'));
    const svc = new ShellIntegrationService('', exec);

    await expect(svc.getRegistrationScope()).resolves.toBe('disabled');
  });

  it('isRegistered() returns false when reg query fails', async () => {
    if (process.platform !== 'win32') return;

    const exec = vi.fn().mockRejectedValue(new Error('key not found'));
    const svc = new ShellIntegrationService('', exec);
    expect(await svc.isRegistered()).toBe(false);
  });
});

// ---- buildRegisterScript (pure function) -----------------------------------

describe('buildRegisterScript', () => {
  const EXE = 'C:\\Program Files\\AwapiCompare\\AwapiCompare.exe';
  const DLL = 'C:\\Program Files\\AwapiCompare\\resources\\AwapiCompareShellExt.dll';
  const PENDING = 'C:\\Users\\me\\AppData\\Roaming\\AwapiCompare\\pending-left.txt';
  const script = buildRegisterScript(EXE, DLL, PENDING);

  it('sets $exe from the provided path', () => {
    expect(script).toContain(`$exe = '${EXE}'`);
  });

  it('sets $dll and $pendingLeft from the provided paths', () => {
    expect(script).toContain(`$dll = '${DLL}'`);
    expect(script).toContain(`$pendingLeft = '${PENDING}'`);
  });

  it('writes ExePath and PendingLeftPath config values for the native handler', () => {
    expect(script).toContain('Software\\Awapi\\AwapiCompare');
    expect(script).toContain('ExePath');
    expect(script).toContain('PendingLeftPath');
  });

  it('registers an InprocServer32 CLSID for each verb (Apartment threading)', () => {
    expect(script).toContain(SHELL_EXT_CLSIDS.root);
    expect(script).toContain(SHELL_EXT_CLSIDS.compareTwo);
    expect(script).toContain(SHELL_EXT_CLSIDS.selectLeft);
    expect(script).toContain(SHELL_EXT_CLSIDS.comparePending);
    expect(script).toContain('InprocServer32');
    expect(script).toContain('Apartment');
  });

  it('binds the root shell keys and each CommandStore verb to ExplorerCommandHandler CLSIDs', () => {
    expect(script).toContain('ExplorerCommandHandler');
    expect(script).toContain(SHELL_EXT_CLSIDS.root);
  });

  it('guards the native COM bindings behind a DLL load/arch check', () => {
    expect(script).toContain('$dllLoadable = Test-AwapiDllLoadable $dll');
    expect(script).toContain('if ($dllLoadable) {');
  });

  it('detects the handler DLL architecture against the host architecture', () => {
    expect(script).toContain('function Test-AwapiDllLoadable($path) {');
    // True native OS arch comes from the HKLM Session Manager value so emulated
    // x64 PowerShell on arm64 is not mistaken for an AMD64 host.
    expect(script).toContain('Session Manager\\Environment');
    expect(script).toContain('PROCESSOR_ARCHITECTURE');
    expect(script).toContain('PROCESSOR_ARCHITEW6432');
    expect(script).toContain('0xAA64');
    expect(script).toContain('0x8664');
  });

  it('targets both the file (*) and folder (Directory) registry keys', () => {
    expect(script).toContain('Classes\\*\\shell\\AwapiCompare');
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompare');
  });

  it('registers CommandStore verb ids', () => {
    expect(script).toContain('AwapiCompare.SelectLeft');
    expect(script).toContain('AwapiCompare.ComparePending');
    expect(script).toContain('AwapiCompare.CompareTwo');
  });

  it('includes the --set-left flag in the SetLeft command', () => {
    expect(script).toContain('--set-left');
  });

  it('includes the --compare-pending flag in the Compare command', () => {
    expect(script).toContain('--compare-pending');
  });

  it('includes the --compare-add flag for the multi-select verb', () => {
    expect(script).toContain('--compare-add');
  });

  it('uses %1 as the Explorer path placeholder', () => {
    expect(script).toContain('%1');
  });

  it('binds the COM submenu (root + verbs) only when the DLL is loadable', () => {
    expect(script).toContain('if ($dllLoadable) {');
    expect(script).toContain(SHELL_EXT_CLSIDS.root);
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name 'ExplorerCommandHandler' -Value $clsidRoot",
    );
  });

  it('falls back to a classic ExtendedSubCommandsKey submenu when the DLL cannot load', () => {
    expect(script).toContain('} else {');
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name 'MUIVerb' -Value 'AwapiCompare'",
    );
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name 'ExtendedSubCommandsKey' -Value 'AwapiCompare.Cascade'",
    );
    // The cascade class key backs the per-user submenu reliably.
    expect(script).toContain("$cascade = 'HKCU:\\Software\\Classes\\AwapiCompare.Cascade'");
    expect(script).toContain('01SelectLeft');
    expect(script).toContain('03CompareTwo');
  });

  it('clears stale per-mode keys so re-registration can switch modes cleanly', () => {
    expect(script).toContain("Remove-ItemProperty -LiteralPath $t -Name 'MUIVerb'");
    expect(script).toContain("Remove-ItemProperty -LiteralPath $t -Name 'SubCommands'");
    expect(script).toContain("Remove-ItemProperty -LiteralPath $t -Name 'ExtendedSubCommandsKey'");
    expect(script).toContain("Remove-ItemProperty -LiteralPath $t -Name 'ExplorerCommandHandler'");
    expect(script).toContain("Remove-Item -LiteralPath ($t + '\\command')");
  });

  it('uses LiteralPath for wildcard file-class writes', () => {
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name '(default)' -Value 'AwapiCompare'",
    );
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name 'MultiSelectModel' -Value 'Player'",
    );
    expect(script).toContain("Set-ItemProperty -LiteralPath $t -Name 'Icon'");
    expect(script).toContain(
      "Set-ItemProperty -LiteralPath $t -Name 'ExplorerCommandHandler' -Value $clsidRoot",
    );
  });

  it('sets MultiSelectModel to Player', () => {
    expect(script).toContain('MultiSelectModel');
    expect(script).toContain('Player');
  });

  it('targets Explorer CommandStore keys', () => {
    expect(script).toContain('CurrentVersion\\Explorer\\CommandStore\\shell');
  });

  it('escapes single quotes in the exe path', () => {
    const tricky = "C:\\Apps\\it's here\\App.exe";
    const s = buildRegisterScript(tricky, DLL, PENDING);
    expect(s).toContain("it''s here");
  });
});

// ---- buildUnregisterScript (pure function) ---------------------------------

describe('buildUnregisterScript', () => {
  const script = buildUnregisterScript();

  it('removes the file (*) key', () => {
    expect(script).toContain('Classes\\*\\shell\\AwapiCompare');
  });

  it('removes the folder (Directory) key', () => {
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompare');
  });

  it('removes legacy pre-COM verb keys from file and folder shells', () => {
    expect(script).toContain('Classes\\*\\shell\\AwapiCompareDoCompare');
    expect(script).toContain('Classes\\*\\shell\\AwapiCompareSetLeft');
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompareDoCompare');
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompareSetLeft');
  });

  it('removes CommandStore keys', () => {
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.SelectLeft');
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.ComparePending');
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.CompareTwo');
  });

  it('removes the native CLSID and config keys', () => {
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.root}`);
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.compareTwo}`);
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.selectLeft}`);
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.comparePending}`);
    expect(script).toContain('Software\\Awapi\\AwapiCompare');
  });

  it('uses Remove-Item with -Recurse', () => {
    expect(script).toContain('Remove-Item');
    expect(script).toContain('-Recurse');
  });

  it('uses LiteralPath for wildcard file-class removals', () => {
    expect(script).toContain(
      "Remove-Item -LiteralPath 'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompare'",
    );
    expect(script).toContain(
      "Remove-Item -LiteralPath 'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareDoCompare'",
    );
    expect(script).toContain(
      "Remove-Item -LiteralPath 'HKCU:\\Software\\Classes\\*\\shell\\AwapiCompareSetLeft'",
    );
  });

  it('suppresses errors for missing keys', () => {
    expect(script).toContain('SilentlyContinue');
  });
});
