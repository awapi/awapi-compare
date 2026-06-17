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

  it('isRegistered() queries the Directory registry key', async () => {
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
    expect(script).toContain(SHELL_EXT_CLSIDS.compareTwo);
    expect(script).toContain(SHELL_EXT_CLSIDS.selectLeft);
    expect(script).toContain(SHELL_EXT_CLSIDS.comparePending);
    expect(script).toContain('InprocServer32');
    expect(script).toContain('Apartment');
  });

  it('binds each CommandStore verb to its ExplorerCommandHandler CLSID', () => {
    expect(script).toContain('ExplorerCommandHandler');
  });

  it('guards the native COM bindings behind Test-Path on the DLL', () => {
    expect(script).toContain('if (Test-Path $dll)');
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

  it('includes the --compare-two flag for multi-select compare', () => {
    expect(script).toContain('--compare-two');
  });

  it('uses %1 as the Explorer path placeholder', () => {
    expect(script).toContain('%1');
  });

  it('sets MUIVerb and SubCommands for the submenu grouping', () => {
    expect(script).toContain('MUIVerb');
    expect(script).toContain('SubCommands');
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

  it('removes CommandStore keys', () => {
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.SelectLeft');
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.ComparePending');
    expect(script).toContain('CommandStore\\shell\\AwapiCompare.CompareTwo');
  });

  it('removes the native CLSID and config keys', () => {
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.compareTwo}`);
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.selectLeft}`);
    expect(script).toContain(`CLSID\\${SHELL_EXT_CLSIDS.comparePending}`);
    expect(script).toContain('Software\\Awapi\\AwapiCompare');
  });

  it('uses Remove-Item with -Recurse', () => {
    expect(script).toContain('Remove-Item');
    expect(script).toContain('-Recurse');
  });

  it('suppresses errors for missing keys', () => {
    expect(script).toContain('SilentlyContinue');
  });
});
