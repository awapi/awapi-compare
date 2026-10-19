import { describe, expect, it } from 'vitest';

import { CliService } from './cliService.js';
import { NotImplementedError } from './errors.js';
import { UpdaterService } from './updaterService.js';

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
