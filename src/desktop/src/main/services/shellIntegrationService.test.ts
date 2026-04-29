import { describe, expect, it, vi } from 'vitest';

import {
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
    expect(args.some((a) => a.includes('Directory'))).toBe(true);
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
  const script = buildRegisterScript(EXE);

  it('sets $exe from the provided path', () => {
    expect(script).toContain(`$exe = '${EXE}'`);
  });

  it('targets both the file (*) and folder (Directory) registry keys', () => {
    expect(script).toContain('Classes\\*\\shell\\AwapiCompare');
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompare');
  });

  it('registers both sub-verbs', () => {
    expect(script).toContain('01.SetLeft');
    expect(script).toContain('02.Compare');
  });

  it('includes the --set-left flag in the SetLeft command', () => {
    expect(script).toContain('--set-left');
  });

  it('includes the --compare-pending flag in the Compare command', () => {
    expect(script).toContain('--compare-pending');
  });

  it('uses %1 as the Explorer path placeholder', () => {
    expect(script).toContain('%1');
  });

  it('sets MUIVerb and SubCommands for the submenu grouping', () => {
    expect(script).toContain('MUIVerb');
    expect(script).toContain('SubCommands');
  });

  it('escapes single quotes in the exe path', () => {
    const tricky = "C:\\Apps\\it's here\\App.exe";
    const s = buildRegisterScript(tricky);
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

  it('uses Remove-Item with -Recurse', () => {
    expect(script).toContain('Remove-Item');
    expect(script).toContain('-Recurse');
  });

  it('suppresses errors for missing keys', () => {
    expect(script).toContain('SilentlyContinue');
  });
});
