import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseDesktopArgs } from './cliArgs.js';

// Use an absolute path that resolves consistently on both POSIX and Windows.
const CWD = resolve('/work');
const opts = { cwd: CWD, env: {} as NodeJS.ProcessEnv };

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
        leftRoot: resolve(CWD, 'a'),
        rightRoot: resolve(CWD, 'b'),
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
        leftRoot: resolve(CWD, 'a'),
        rightRoot: resolve(CWD, 'b'),
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
        cwd: CWD,
        env: { AWAPI_LEFT: './a', AWAPI_RIGHT: resolve('/abs/b'), AWAPI_MODE: 'binary' },
      }),
    ).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: resolve(CWD, 'a'),
        rightRoot: resolve('/abs/b'),
        mode: 'binary',
      },
    });
  });

  it('CLI flags override env vars', () => {
    expect(
      parseDesktopArgs(['--left', './cli-a', '--right', './cli-b'], {
        cwd: CWD,
        env: { AWAPI_LEFT: './env-a', AWAPI_RIGHT: './env-b' },
      }),
    ).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: resolve(CWD, 'cli-a'),
        rightRoot: resolve(CWD, 'cli-b'),
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
    expect(parseDesktopArgs(['--left', './rel'], opts)).toEqual({ kind: 'openLeft', path: resolve(CWD, 'rel') });
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

  // ---- context-menu pick args ------------------------------------------

  it('parses --set-left with an absolute path', () => {
    expect(parseDesktopArgs(['--set-left', '/folders/left'], opts)).toEqual({
      kind: 'setLeft',
      path: '/folders/left',
    });
  });

  it('resolves --set-left relative path against cwd', () => {
    expect(parseDesktopArgs(['--set-left', './a'], opts)).toEqual({
      kind: 'setLeft',
      path: resolve(CWD, 'a'),
    });
  });

  it('accepts --set-left=<value> form', () => {
    expect(parseDesktopArgs(['--set-left=/abs/path'], opts)).toEqual({
      kind: 'setLeft',
      path: '/abs/path',
    });
  });

  it('parses --compare-pending with an absolute path', () => {
    expect(parseDesktopArgs(['--compare-pending', '/folders/right'], opts)).toEqual({
      kind: 'comparePending',
      path: '/folders/right',
    });
  });

  it('resolves --compare-pending relative path against cwd', () => {
    expect(parseDesktopArgs(['--compare-pending', './b'], opts)).toEqual({
      kind: 'comparePending',
      path: resolve(CWD, 'b'),
    });
  });

  it('accepts --compare-pending=<value> form', () => {
    expect(parseDesktopArgs(['--compare-pending=/abs/path'], opts)).toEqual({
      kind: 'comparePending',
      path: '/abs/path',
    });
  });

  it('--register-shell takes priority over --set-left', () => {
    const r = parseDesktopArgs(['--register-shell', '--set-left', '/a'], opts);
    expect(r?.kind).toBe('registerShell');
  });

  it('rejects --set-left without value', () => {
    expect(() => parseDesktopArgs(['--set-left'], opts)).toThrow(/--set-left/);
  });

  it('rejects --compare-pending without value', () => {
    expect(() => parseDesktopArgs(['--compare-pending'], opts)).toThrow(/--compare-pending/);
  });

  // ---- Positional paths (Windows "Send to") --------------------------------

  it('two absolute positional paths → compare session with default mode', () => {
    const left = resolve('/work/a');
    const right = resolve('/work/b');
    expect(parseDesktopArgs([left, right], opts)).toEqual({
      kind: 'compare',
      session: { type: 'folder', leftRoot: left, rightRoot: right, mode: 'quick' },
    });
  });

  it('two relative positional paths are resolved against cwd', () => {
    const r = parseDesktopArgs(['folderA', 'folderB'], opts);
    expect(r).toEqual({
      kind: 'compare',
      session: {
        type: 'folder',
        leftRoot: resolve(CWD, 'folderA'),
        rightRoot: resolve(CWD, 'folderB'),
        mode: 'quick',
      },
    });
  });

  it('--mode flag is respected alongside two positional paths', () => {
    const left = resolve('/work/a');
    const right = resolve('/work/b');
    const r = parseDesktopArgs(['--mode', 'thorough', left, right], opts);
    expect(r?.kind).toBe('compare');
    if (r?.kind === 'compare') expect(r.session.mode).toBe('thorough');
  });

  it('one positional path does not trigger a compare (returns null)', () => {
    expect(parseDesktopArgs([resolve('/work/a')], opts)).toBeNull();
  });

  it('positional paths are ignored when --left/--right flags are present', () => {
    const r = parseDesktopArgs(
      ['--left', './a', '--right', './b', resolve('/work/c'), resolve('/work/d')],
      opts,
    );
    expect(r?.kind).toBe('compare');
    if (r?.kind === 'compare') {
      expect(r.session.leftRoot).toBe(resolve(CWD, 'a'));
      expect(r.session.rightRoot).toBe(resolve(CWD, 'b'));
    }
  });
});
