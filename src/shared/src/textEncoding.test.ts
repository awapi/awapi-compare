import { describe, expect, it } from 'vitest';
import {
  TEXT_ENCODINGS,
  decodeText,
  decodeTextFile,
  detectEncoding,
  detectEol,
  encodeText,
  encodingLabel,
  isTextEncodingId,
  type TextEncodingId,
} from './textEncoding.js';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);

describe('detectEncoding / decodeTextFile', () => {
  it('detects plain ASCII / valid UTF-8 as utf-8', () => {
    expect(detectEncoding(new TextEncoder().encode('hello'))).toBe('utf-8');
    expect(decodeTextFile(new TextEncoder().encode('héllo €'))).toEqual({
      text: 'héllo €',
      encoding: 'utf-8',
    });
  });

  it('detects the UTF-8 BOM and strips it from the text', () => {
    const buf = bytes(0xef, 0xbb, 0xbf, 0x68, 0x69);
    expect(decodeTextFile(buf)).toEqual({ text: 'hi', encoding: 'utf-8-bom' });
  });

  it('detects UTF-16 LE / BE BOMs', () => {
    expect(decodeTextFile(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00))).toEqual({
      text: 'hi',
      encoding: 'utf-16le',
    });
    expect(decodeTextFile(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0x69))).toEqual({
      text: 'hi',
      encoding: 'utf-16be',
    });
  });

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    // "café €" in Windows-1252
    const buf = bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80);
    expect(decodeTextFile(buf)).toEqual({ text: 'café €', encoding: 'windows-1252' });
  });

  it('treats an empty buffer as utf-8', () => {
    expect(decodeTextFile(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' });
  });
});

describe('decodeText', () => {
  it('decodes UTF-16 without a BOM and flags a dangling odd byte', () => {
    expect(decodeText(bytes(0x68, 0x00, 0x69, 0x00), 'utf-16le')).toBe('hi');
    expect(decodeText(bytes(0x00, 0x68, 0x00, 0x69), 'utf-16be')).toBe('hi');
    expect(decodeText(bytes(0x68, 0x00, 0x69), 'utf-16le')).toBe('h\ufffd');
  });

  it('decodes malformed UTF-8 leniently', () => {
    expect(decodeText(bytes(0x61, 0xff, 0x62), 'utf-8')).toBe('a\ufffdb');
  });

  it('maps the Windows-1252 0x80-0x9F block', () => {
    expect(decodeText(bytes(0x93, 0x68, 0x69, 0x94), 'windows-1252')).toBe('\u201chi\u201d');
    expect(decodeText(bytes(0x81), 'windows-1252')).toBe('\u0081');
  });

  it('handles buffers larger than the internal chunk size', () => {
    const big = new Uint8Array(50_000).fill(0x61);
    expect(decodeText(big, 'windows-1252')).toHaveLength(50_000);
    const le = new Uint8Array(50_000);
    for (let i = 0; i < le.length; i += 2) le[i] = 0x61;
    expect(decodeText(le, 'utf-16le')).toHaveLength(25_000);
  });
});

describe('encodeText', () => {
  it('encodes utf-8 with and without a BOM', () => {
    expect(encodeText('hi', 'utf-8')).toEqual({ bytes: bytes(0x68, 0x69), unmappable: 0 });
    expect(encodeText('hi', 'utf-8-bom')).toEqual({
      bytes: bytes(0xef, 0xbb, 0xbf, 0x68, 0x69),
      unmappable: 0,
    });
  });

  it('encodes UTF-16 with a BOM, including astral characters', () => {
    expect(encodeText('hi', 'utf-16le').bytes).toEqual(bytes(0xff, 0xfe, 0x68, 0, 0x69, 0));
    expect(encodeText('hi', 'utf-16be').bytes).toEqual(bytes(0xfe, 0xff, 0, 0x68, 0, 0x69));
    // U+1F600 → surrogate pair D83D DE00
    expect(encodeText('\u{1F600}', 'utf-16be').bytes).toEqual(
      bytes(0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00),
    );
  });

  it('encodes Windows-1252 and counts unmappable characters', () => {
    expect(encodeText('café €', 'windows-1252')).toEqual({
      bytes: bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80),
      unmappable: 0,
    });
    const lossy = encodeText('a\u4e2db\u{1F600}', 'windows-1252');
    expect(lossy.bytes).toEqual(bytes(0x61, 0x3f, 0x62, 0x3f));
    expect(lossy.unmappable).toBe(2);
  });

  it('round-trips every encoding', () => {
    const text = 'line1\r\nline2 € é\n';
    const ids: TextEncodingId[] = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252'];
    for (const id of ids) {
      const { bytes: encoded, unmappable } = encodeText(text, id);
      expect(unmappable).toBe(0);
      expect(decodeTextFile(encoded)).toEqual({ text, encoding: id });
    }
  });
});

describe('detectEol', () => {
  it('classifies line endings', () => {
    expect(detectEol('abc')).toBe('none');
    expect(detectEol('a\nb\n')).toBe('lf');
    expect(detectEol('a\r\nb\r\n')).toBe('crlf');
    expect(detectEol('a\rb\r')).toBe('cr');
    expect(detectEol('a\r\nb\n')).toBe('mixed');
    expect(detectEol('a\rb\n')).toBe('mixed');
  });
});

describe('encoding catalogue', () => {
  it('exposes labels and a type guard', () => {
    expect(encodingLabel('utf-16le')).toBe('UTF-16 LE');
    expect(encodingLabel('nope' as TextEncodingId)).toBe('nope');
    expect(TEXT_ENCODINGS.every((e) => isTextEncodingId(e.id))).toBe(true);
    expect(isTextEncodingId('ascii')).toBe(false);
  });
});
