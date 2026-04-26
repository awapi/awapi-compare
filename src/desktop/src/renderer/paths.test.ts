import { describe, expect, it } from 'vitest';
import { basename, extname, joinPath } from './paths.js';

describe('joinPath', () => {
  it('joins a posix root and rel path with /', () => {
    expect(joinPath('/a/b', 'c/d.txt')).toBe('/a/b/c/d.txt');
  });

  it('strips trailing separators on the root', () => {
    expect(joinPath('/a/b/', 'c.txt')).toBe('/a/b/c.txt');
    expect(joinPath('/a/b//', 'c.txt')).toBe('/a/b/c.txt');
  });

  it('strips a leading separator on the rel path', () => {
    expect(joinPath('/a/b', '/c.txt')).toBe('/a/b/c.txt');
  });

  it('uses backslash when the root looks like a Windows path', () => {
    expect(joinPath('C:\\a\\b', 'c/d.txt')).toBe('C:\\a\\b\\c\\d.txt');
  });

  it('returns the rel path when the root is empty', () => {
    expect(joinPath('', 'a/b.txt')).toBe('a/b.txt');
  });

  it('returns the root when the rel path is empty', () => {
    expect(joinPath('/a', '')).toBe('/a');
  });
});

describe('basename', () => {
  it('returns the trailing path segment', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('C:\\a\\b\\c.txt')).toBe('c.txt');
    expect(basename('foo.txt')).toBe('foo.txt');
  });
});

describe('extname', () => {
  it('returns the extension including the dot', () => {
    expect(extname('a.txt')).toBe('.txt');
    expect(extname('archive.tar.gz')).toBe('.gz');
  });

  it('returns an empty string when no extension is present', () => {
    expect(extname('Dockerfile')).toBe('');
    expect(extname('.env')).toBe('');
  });
});
