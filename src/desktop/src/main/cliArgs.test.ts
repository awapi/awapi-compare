import { describe, expect, it } from 'vitest';

import { parseDesktopArgs } from './cliArgs.js';

const opts = { cwd: '/work', env: {} as NodeJS.ProcessEnv };

describe('parseDesktopArgs', () => {
  it('returns null when no --left/--right and no env vars', () => {
    expect(parseDesktopArgs([], opts)).toBeNull();
    expect(parseDesktopArgs(['--remote-debugging-port=0'], opts)).toBeNull();
  });

  it('parses --left/--right with default mode and folder type', () => {
    expect(parseDesktopArgs(['--left', './a', '--right', './b'], opts)).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: '/work/a',
        rightRoot: '/work/b',
        mode: 'quick',
      },
    });
  });

  it('accepts --flag=value form', () => {
    expect(
      parseDesktopArgs(['--type=folder', '--left=./a', '--right=./b', '--mode=thorough'], opts),
    ).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: '/work/a',
        rightRoot: '/work/b',
        mode: 'thorough',
      },
    });
  });

  it('keeps absolute paths unchanged', () => {
    const r = parseDesktopArgs(['--left', '/x/a', '--right', '/y/b'], opts);
    expect(r?.kind).toBe('compare');
    if (r?.kind === 'compare') {
      expect(r.session.leftRoot).toBe('/x/a');
      expect(r.session.rightRoot).toBe('/y/b');
    }
  });

  it('falls back to AWAPI_LEFT / AWAPI_RIGHT / AWAPI_MODE env vars', () => {
    expect(
      parseDesktopArgs([], {
        cwd: '/work',
        env: { AWAPI_LEFT: './a', AWAPI_RIGHT: '/abs/b', AWAPI_MODE: 'binary' },
      }),
    ).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: '/work/a',
        rightRoot: '/abs/b',
        mode: 'binary',
      },
    });
  });

  it('CLI flags override env vars', () => {
    expect(
      parseDesktopArgs(['--left', './cli-a', '--right', './cli-b'], {
        cwd: '/work',
        env: { AWAPI_LEFT: './env-a', AWAPI_RIGHT: './env-b' },
      }),
    ).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: '/work/cli-a',
        rightRoot: '/work/cli-b',
        mode: 'quick',
      },
    });
  });

  it('ignores unknown flags (Electron-injected etc.)', () => {
    const r = parseDesktopArgs(
      ['--remote-debugging-port=0', '--left', '/a', '--right', '/b', '--inspect'],
      opts,
    );
    expect(r?.kind).toBe('compare');
    if (r?.kind === 'compare') expect(r.session.leftRoot).toBe('/a');
  });

  it('rejects non-folder --type', () => {
    expect(() =>
      parseDesktopArgs(['--type', 'file', '--left', '/a', '--right', '/b'], opts),
    ).toThrow(/folder/);
  });

  it('rejects unknown --mode', () => {
    expect(() =>
      parseDesktopArgs(['--mode', 'fuzzy', '--left', '/a', '--right', '/b'], opts),
    ).toThrow(/--mode/);
  });

  it('rejects --left/--right without value', () => {
    expect(() => parseDesktopArgs(['--left'], opts)).toThrow(/--left/);
    expect(() => parseDesktopArgs(['--left', '--right', '/b'], opts)).toThrow(/--left/);
  });

  it('returns openLeft when --left is given without --right', () => {
    expect(parseDesktopArgs(['--left', '/a'], opts)).toEqual({ kind: 'openLeft', path: '/a' });
  });

  it('resolves --left relative path for openLeft', () => {
    expect(parseDesktopArgs(['--left', './rel'], opts)).toEqual({ kind: 'openLeft', path: '/work/rel' });
  });

  it('rejects --right without --left', () => {
    expect(() => parseDesktopArgs(['--right', '/b'], opts)).toThrow(/--right requires --left/);
  });

  // ---- shell integration args ------------------------------------------

  it('parses --register-shell', () => {
    expect(parseDesktopArgs(['--register-shell'], opts)).toEqual({ kind: 'registerShell' });
  });

  it('parses --unregister-shell', () => {
    expect(parseDesktopArgs(['--unregister-shell'], opts)).toEqual({ kind: 'unregisterShell' });
  });

  it('--register-shell takes priority over --left/--right', () => {
    const r = parseDesktopArgs(['--register-shell', '--left', '/a', '--right', '/b'], opts);
    expect(r?.kind).toBe('registerShell');
  });
});
