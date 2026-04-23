import { describe, expect, it } from 'vitest';

import { CliService } from './cliService.js';
import { NotImplementedError } from './errors.js';
import { LicenseService } from './licenseService.js';
import { UpdaterService } from './updaterService.js';

describe('LicenseService', () => {
  it('defaults to an invalid status before Phase 8 wires real licensing', async () => {
    await expect(new LicenseService().status()).resolves.toEqual({ state: 'invalid' });
  });

  it('activate and deactivate are deferred', () => {
    const svc = new LicenseService();
    expect(() => svc.activate({ key: 'ABCD' })).toThrow(NotImplementedError);
    expect(() => svc.deactivate()).toThrow(NotImplementedError);
  });
});

describe('UpdaterService', () => {
  it('check() reports no update in the skeleton', async () => {
    await expect(new UpdaterService().check()).resolves.toEqual({ available: false });
  });

  it('download/install are deferred', () => {
    const svc = new UpdaterService();
    expect(() => svc.download()).toThrow(NotImplementedError);
    expect(() => svc.install()).toThrow(NotImplementedError);
  });
});

describe('CliService', () => {
  it('handoff is deferred to Phase 10', () => {
    expect(() => new CliService().handoff({ left: '/a', right: '/b' })).toThrow(
      NotImplementedError,
    );
  });
});
