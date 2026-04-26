import { describe, expect, it } from 'vitest';
import {
  LARGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  classifyFile,
  decodeUtf8,
  languageFromPath,
} from './fileKind.js';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('classifyFile', () => {
  it('classifies UTF-8 text as text', () => {
    const buf = new TextEncoder().encode('hello, world\n');
    expect(classifyFile(buf)).toEqual({ kind: 'text' });
  });

  it('strips a UTF-8 BOM via decodeUtf8 round-trip', () => {
    const buf = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hi')]);
    expect(classifyFile(buf).kind).toBe('text');
    expect(decodeUtf8(buf)).toBe('hi');
  });

  it('classifies a buffer with a NUL byte as binary', () => {
    expect(classifyFile(bytes(0x68, 0x00, 0x69))).toEqual({ kind: 'binary' });
  });

  it('classifies high-density-control-byte buffers as binary', () => {
    const buf = new Uint8Array(200);
    for (let i = 0; i < buf.length; i += 1) buf[i] = 0x01;
    expect(classifyFile(buf)).toEqual({ kind: 'binary' });
  });

  it('detects PNG by magic bytes', () => {
    const buf = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    expect(classifyFile(buf)).toEqual({ kind: 'image', imageFormat: 'png' });
  });

  it('detects JPEG by magic bytes', () => {
    expect(classifyFile(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      kind: 'image',
      imageFormat: 'jpeg',
    });
  });

  it('detects GIF87a / GIF89a', () => {
    expect(
      classifyFile(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00)),
    ).toEqual({ kind: 'image', imageFormat: 'gif' });
    expect(
      classifyFile(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00)),
    ).toEqual({ kind: 'image', imageFormat: 'gif' });
  });

  it('detects WEBP via RIFF + WEBP magic', () => {
    const buf = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
    expect(classifyFile(buf)).toEqual({ kind: 'image', imageFormat: 'webp' });
  });

  it('detects BMP via "BM" magic', () => {
    expect(classifyFile(bytes(0x42, 0x4d, 0, 0))).toEqual({
      kind: 'image',
      imageFormat: 'bmp',
    });
  });

  it('treats empty files as text', () => {
    expect(classifyFile(new Uint8Array(0))).toEqual({ kind: 'text' });
    expect(classifyFile(new Uint8Array(0), '.png')).toEqual({ kind: 'text' });
  });
});

describe('decodeUtf8', () => {
  it('decodes plain UTF-8', () => {
    expect(decodeUtf8(new TextEncoder().encode('héllo'))).toBe('héllo');
  });

  it('replaces malformed sequences instead of throwing', () => {
    expect(decodeUtf8(bytes(0xc3, 0x28))).toContain('\uFFFD');
  });
});

describe('languageFromPath', () => {
  it('maps known extensions to Monaco language ids', () => {
    expect(languageFromPath('a.ts')).toBe('typescript');
    expect(languageFromPath('a.tsx')).toBe('typescript');
    expect(languageFromPath('a.js')).toBe('javascript');
    expect(languageFromPath('a.json')).toBe('json');
    expect(languageFromPath('a.md')).toBe('markdown');
    expect(languageFromPath('a.html')).toBe('html');
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(languageFromPath('a.unknown-ext')).toBe('plaintext');
    expect(languageFromPath('Dockerfile')).toBe('plaintext');
  });

  it('handles paths with mixed separators', () => {
    expect(languageFromPath('C:\\src\\App.TSX')).toBe('typescript');
    expect(languageFromPath('/var/log/foo.YAML')).toBe('yaml');
  });
});

describe('size constants', () => {
  it('defines sane defaults', () => {
    expect(LARGE_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_TEXT_FILE_BYTES).toBe(50 * 1024 * 1024);
  });
});
