import { describe, expect, it, vi } from 'vitest';

import {
  ShellIntegrationService,
  SHELLEX_CLSID,
  SHELL_INTEGRATION_VERSION,
  SPARSE_PACKAGE_NAME,
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

  it('isRegistered() queries the ShellIntegrationVersion marker', async () => {
    if (process.platform !== 'win32') return;

    const exec = makeExec();
    const svc = new ShellIntegrationService('', exec);
    await svc.isRegistered();

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('reg');
    expect(args).toContain('HKCU\\Software\\AwapiCompare');
    expect(args).toContain('ShellIntegrationVersion');
  });

  it('isRegistered() returns true only for the current marker version', async () => {
    if (process.platform !== 'win32') return;

    const reply = (v: string) =>
      vi.fn().mockResolvedValue({
        stdout: `\r\nHKEY_CURRENT_USER\\Software\\AwapiCompare\r\n    ShellIntegrationVersion    REG_SZ    ${v}\r\n`,
      });
    expect(await new ShellIntegrationService('', reply(SHELL_INTEGRATION_VERSION)).isRegistered()).toBe(true);
    expect(await new ShellIntegrationService('', reply('1')).isRegistered()).toBe(false);
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

  it('targets both the file (*) and folder (Directory) registry roots', () => {
    expect(script).toContain('Classes\\Directory\\shell');
    expect(script).toContain('Classes\\*\\shell');
  });

  it('registers two flat top-level verbs', () => {
    expect(script).toContain('AwapiCompareSetLeft');
    expect(script).toContain('AwapiCompareDoCompare');
  });

  it('verb labels include AwapiCompare branding', () => {
    expect(script).toContain('Select Left Side for AwapiCompare');
    expect(script).toContain('Compare with AwapiCompare');
  });

  it('includes the --set-left flag', () => {
    expect(script).toContain('--set-left');
  });

  it('includes the --compare-pending flag', () => {
    expect(script).toContain('--compare-pending');
  });

  it('uses %1 as the Explorer path placeholder', () => {
    expect(script).toContain('%1');
  });

  it('adds MultiSelectModel=Single to suppress verbs on multi-select', () => {
    expect(script).toContain('MultiSelectModel');
    expect(script).toContain('Single');
  });

  it('registers the COM CLSID for the shellex DLL', () => {
    expect(script).toContain(SHELLEX_CLSID);
    expect(script).toContain('InprocServer32');
    expect(script).toContain('ThreadingModel');
    expect(script).toContain('Apartment');
  });

  it('registers the COM extension under file, Directory, and Directory\\Background', () => {
    expect(script).toContain("'*'");
    expect(script).toContain("'Directory'");
    expect(script).toContain("'Directory\\Background'");
    expect(script).toContain('ContextMenuHandlers\\AwapiCompare');
  });

  it('stores the EXE path in HKCU\\Software\\AwapiCompare for the DLL to read', () => {
    expect(script).toContain('Software\\AwapiCompare');
    expect(script).toContain('ExePath');
  });

  it('skips COM registration when the DLL does not exist (Test-Path guard)', () => {
    expect(script).toContain('Test-Path');
    expect(script).toContain('awapi_shellex.dll');
  });

  it('picks the shellex\\<arch> folder by the OS native arch (not the process arch)', () => {
    expect(script).toContain('Session Manager\\Environment');
    expect(script).toContain("$nativeArch -eq 'ARM64'");
    expect(script).toContain('"shellex\\$arch"');
  });

  it('escapes single quotes in the exe path', () => {
    const tricky = "C:\\Apps\\it's here\\App.exe";
    const s = buildRegisterScript(tricky);
    expect(s).toContain("it''s here");
  });

  it('creates a SendTo shortcut via WScript.Shell', () => {
    expect(script).toContain('GetFolderPath');
    expect(script).toContain('WScript.Shell');
    expect(script).toContain('AwapiCompare.lnk');
    expect(script).toContain('$sc.Save()');
  });

  it('registers the Windows 11 sparse package with the install dir as external location', () => {
    expect(script).toContain('awapi_shellex.msix');
    expect(script).toContain('-ExternalLocation $appDir');
    expect(script).toContain('-AllowUnsigned');
    expect(script).toContain('Version.Build -ge 22000');
    expect(script).toContain(`Get-AppxPackage -Name '${SPARSE_PACKAGE_NAME}' | Remove-AppxPackage`);
  });

  it('writes the ShellIntegrationVersion marker last', () => {
    const lines = script.trim().split('\n');
    expect(lines[lines.length - 1]).toContain(
      `-Name 'ShellIntegrationVersion' -Value '${SHELL_INTEGRATION_VERSION}'`,
    );
  });
});

// ---- buildUnregisterScript (pure function) ---------------------------------

describe('buildUnregisterScript', () => {
  const script = buildUnregisterScript();

  it('removes the new flat verbs under Directory', () => {
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompareSetLeft');
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompareDoCompare');
  });

  it('removes the new flat verbs under * (files)', () => {
    expect(script).toContain('Classes\\*\\shell\\AwapiCompareSetLeft');
    expect(script).toContain('Classes\\*\\shell\\AwapiCompareDoCompare');
  });

  it('also removes legacy cascading keys for clean upgrade', () => {
    expect(script).toContain('Classes\\Directory\\shell\\AwapiCompare');
    expect(script).toContain('Classes\\*\\shell\\AwapiCompare');
  });

  it('removes the COM CLSID key', () => {
    expect(script).toContain(SHELLEX_CLSID);
  });

  it('removes the COM ContextMenuHandlers entries for all three roots', () => {
    expect(script).toContain('Classes\\*\\shellex\\ContextMenuHandlers\\AwapiCompare');
    expect(script).toContain('Classes\\Directory\\shellex\\ContextMenuHandlers\\AwapiCompare');
    expect(script).toContain('Classes\\Directory\\Background\\shellex\\ContextMenuHandlers\\AwapiCompare');
  });

  it('removes the stored EXE path key', () => {
    expect(script).toContain('Software\\AwapiCompare');
  });

  it('uses Remove-Item with -Recurse', () => {
    expect(script).toContain('Remove-Item');
    expect(script).toContain('-Recurse');
  });

  it('suppresses errors for missing keys', () => {
    expect(script).toContain('SilentlyContinue');
  });

  it('also removes the SendTo shortcut', () => {
    expect(script).toContain('AwapiCompare.lnk');
    expect(script).toContain('GetFolderPath');
  });

  it('removes the sparse package', () => {
    expect(script).toContain(`Get-AppxPackage -Name '${SPARSE_PACKAGE_NAME}' | Remove-AppxPackage`);
  });
});
