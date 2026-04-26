import { describe, expect, it } from 'vitest';

import { DEFAULT_DIFF_OPTIONS, mergeDiffOptions } from '@awapi/shared';

import { pairingKey } from './pairing.js';

const DEFAULT_PAIRING = DEFAULT_DIFF_OPTIONS.pairing;

describe('pairingKey — defaults', () => {
  it('returns the path unchanged for ASCII-only inputs under defaults', () => {
    expect(pairingKey('src/foo.ts', DEFAULT_PAIRING)).toBe('src/foo.ts');
  });

  it('NFC-normalises decomposed Unicode under defaults', () => {
    const decomposed = 'cafe\u0301.txt'; // café (NFD)
    const composed = 'caf\u00e9.txt';     // café (NFC)
    expect(pairingKey(decomposed, DEFAULT_PAIRING)).toBe(composed);
    expect(pairingKey(composed, DEFAULT_PAIRING)).toBe(composed);
  });
});

describe('pairingKey — caseSensitive:false', () => {
  const pairing = mergeDiffOptions({ pairing: { caseSensitive: false } }).pairing;

  it('lower-cases the entire path', () => {
    expect(pairingKey('Src/Foo.TS', pairing)).toBe('src/foo.ts');
  });

  it('makes upper- and lower-case names collide', () => {
    expect(pairingKey('README.md', pairing)).toBe(pairingKey('readme.md', pairing));
  });
});

describe('pairingKey — ignoreExtension:true', () => {
  const pairing = mergeDiffOptions({ pairing: { ignoreExtension: true } }).pairing;

  it('strips a single trailing extension from the basename', () => {
    expect(pairingKey('src/foo.ts', pairing)).toBe('src/foo');
    expect(pairingKey('foo.js', pairing)).toBe('foo');
  });

  it('does not touch dots inside directory names', () => {
    expect(pairingKey('a.b/c.d/foo.ts', pairing)).toBe('a.b/c.d/foo');
  });

  it('does not strip dotfiles (no real extension)', () => {
    expect(pairingKey('.env', pairing)).toBe('.env');
    expect(pairingKey('config/.gitignore', pairing)).toBe('config/.gitignore');
  });

  it('only strips the last extension', () => {
    expect(pairingKey('archive.tar.gz', pairing)).toBe('archive.tar');
  });

  it('makes foo.ts pair with foo.js when ignoreExtension is on', () => {
    const a = pairingKey('src/foo.ts', pairing);
    const b = pairingKey('src/foo.js', pairing);
    expect(a).toBe(b);
  });
});

describe('pairingKey — combinations', () => {
  it('applies normalize → lower-case → strip in that order', () => {
    const pairing = mergeDiffOptions({
      pairing: {
        caseSensitive: false,
        ignoreExtension: true,
        unicodeNormalize: true,
      },
    }).pairing;
    expect(pairingKey('Src/Cafe\u0301.TS', pairing)).toBe('src/caf\u00e9');
  });

  it('all options off → identity', () => {
    const pairing = mergeDiffOptions({
      pairing: { caseSensitive: true, ignoreExtension: false, unicodeNormalize: false },
    }).pairing;
    const input = 'Src/Cafe\u0301.TS';
    expect(pairingKey(input, pairing)).toBe(input);
  });
});
