import { describe, expect, it } from 'vitest';
import { parentDir } from './pathUtils.js';

describe('parentDir', () => {
  describe('POSIX', () => {
    it('returns the parent of a normal absolute path', () => {
      expect(parentDir('/Users/omer/projects/foo')).toBe('/Users/omer/projects');
    });

    it('handles a single trailing slash', () => {
      expect(parentDir('/Users/omer/projects/foo/')).toBe('/Users/omer/projects');
    });

    it('handles multiple trailing slashes', () => {
      expect(parentDir('/Users/omer///')).toBe('/Users');
    });

    it('returns "/" for a top-level entry', () => {
      expect(parentDir('/Users')).toBe('/');
    });

    it('returns null for the root', () => {
      expect(parentDir('/')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parentDir('')).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
      expect(parentDir('   ')).toBeNull();
    });

    it('returns null for a relative bareword (cannot navigate up)', () => {
      expect(parentDir('foo')).toBeNull();
    });
  });

  describe('Windows', () => {
    it('returns the parent of a normal drive path', () => {
      expect(parentDir('C:\\Users\\omer\\foo')).toBe('C:\\Users\\omer');
    });

    it('handles a trailing backslash', () => {
      expect(parentDir('C:\\Users\\omer\\foo\\')).toBe('C:\\Users\\omer');
    });

    it('handles forward slashes inside a drive path', () => {
      expect(parentDir('C:/Users/omer/foo')).toBe('C:/Users/omer');
    });

    it('returns drive root with trailing separator', () => {
      expect(parentDir('C:\\Users')).toBe('C:\\');
    });

    it('returns null at the drive root', () => {
      expect(parentDir('C:\\')).toBeNull();
    });

    it('returns null at the bare drive', () => {
      expect(parentDir('C:')).toBeNull();
    });

    it('returns the UNC root for a path inside a share', () => {
      expect(parentDir('\\\\server\\share\\foo\\bar')).toBe('\\\\server\\share\\foo');
      expect(parentDir('\\\\server\\share\\foo')).toBe('\\\\server\\share');
    });

    it('returns null at a bare UNC root', () => {
      expect(parentDir('\\\\server\\share')).toBeNull();
      expect(parentDir('\\\\server\\share\\')).toBeNull();
    });
  });
});
