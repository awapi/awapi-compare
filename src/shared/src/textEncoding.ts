/**
 * Text encoding / line-ending helpers for the file-diff view.
 *
 * Pure & dependency-free (only `TextDecoder` / `TextEncoder`, which exist
 * in both Node and the renderer) so the renderer, main process and tests
 * can share them. The file-diff tab uses these to:
 *
 *  - detect how a file on disk is encoded (BOM sniff, strict UTF-8 probe,
 *    Windows-1252 fallback) and decode it to a string for the editor;
 *  - encode the edited string back to the *same* encoding on save, so a
 *    UTF-16 or Latin-1 file is not silently rewritten as UTF-8;
 *  - report the dominant line-ending style.
 *
 * UTF-16 variants always carry a BOM (`utf-16le` ⇒ `FF FE`, `utf-16be`
 * ⇒ `FE FF`): BOM-less UTF-16 cannot be told apart from binary reliably.
 */

export type TextEncodingId = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface TextEncodingInfo {
  id: TextEncodingId;
  /** Human-readable label for pickers. */
  label: string;
}

/** Encodings the UI offers, in display order. */
export const TEXT_ENCODINGS: readonly TextEncodingInfo[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'windows-1252', label: 'Windows-1252 (Latin-1)' },
];

export function encodingLabel(id: TextEncodingId): string {
  return TEXT_ENCODINGS.find((e) => e.id === id)?.label ?? id;
}

export function isTextEncodingId(value: unknown): value is TextEncodingId {
  return TEXT_ENCODINGS.some((e) => e.id === value);
}

export interface DecodedTextFile {
  text: string;
  encoding: TextEncodingId;
}

/** `none` = no line breaks at all, `mixed` = more than one style present. */
export type EolKind = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';

// Windows-1252 maps 0x80-0x9F to these code points; the five undefined
// slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) pass through as C1 controls, which
// matches the WHATWG encoding standard.
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

const CP1252_REVERSE: ReadonlyMap<number, number> = new Map(
  CP1252_HIGH.map((cp, i) => [cp, 0x80 + i] as const),
);

const CHUNK = 0x4000;

function fromCodeUnits(units: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i < units.length; i += CHUNK) {
    const slice = Array.prototype.slice.call(units, i, i + CHUNK) as number[];
    parts.push(String.fromCharCode(...slice));
  }
  return parts.join('');
}

function bomEncoding(buf: Uint8Array): TextEncodingId | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  return null;
}

/** Strictly decode UTF-8; `null` when the bytes are not valid UTF-8. */
function tryDecodeUtf8(buf: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return null;
  }
}

/**
 * Detect the encoding of `buf` and decode it in one pass (a strict UTF-8
 * probe already yields the decoded string, so we avoid decoding twice).
 */
export function decodeTextFile(buf: Uint8Array): DecodedTextFile {
  const bom = bomEncoding(buf);
  if (bom) return { text: decodeText(buf, bom), encoding: bom };
  const utf8 = tryDecodeUtf8(buf);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };
  return { text: decodeText(buf, 'windows-1252'), encoding: 'windows-1252' };
}

export function detectEncoding(buf: Uint8Array): TextEncodingId {
  return decodeTextFile(buf).encoding;
}

/** Decode `buf` as `encoding`. A leading BOM matching the encoding is dropped. */
export function decodeText(buf: Uint8Array, encoding: TextEncodingId): string {
  switch (encoding) {
    case 'utf-8':
    case 'utf-8-bom': {
      // Non-fatal: malformed sequences become U+FFFD. The default
      // `ignoreBOM: false` strips a leading BOM.
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    case 'utf-16le':
    case 'utf-16be': {
      const le = encoding === 'utf-16le';
      const bom = le ? [0xff, 0xfe] : [0xfe, 0xff];
      const start = buf.length >= 2 && buf[0] === bom[0] && buf[1] === bom[1] ? 2 : 0;
      const count = Math.floor((buf.length - start) / 2);
      const units = new Uint16Array(count);
      for (let i = 0; i < count; i += 1) {
        const a = buf[start + i * 2] ?? 0;
        const b = buf[start + i * 2 + 1] ?? 0;
        units[i] = le ? a | (b << 8) : (a << 8) | b;
      }
      const odd = (buf.length - start) % 2 === 1 ? '\ufffd' : '';
      return fromCodeUnits(units) + odd;
    }
    case 'windows-1252': {
      const units = new Uint16Array(buf.length);
      for (let i = 0; i < buf.length; i += 1) {
        const b = buf[i] ?? 0;
        units[i] = b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] ?? b) : b;
      }
      return fromCodeUnits(units);
    }
  }
}

export interface EncodeResult {
  bytes: Uint8Array;
  /**
   * Number of characters that cannot be represented in `encoding` and
   * were replaced with `?`. Always `0` for the Unicode encodings.
   */
  unmappable: number;
}

/** Encode `text` as `encoding` (adding a BOM for the `-bom` / UTF-16 variants). */
export function encodeText(text: string, encoding: TextEncodingId): EncodeResult {
  switch (encoding) {
    case 'utf-8':
      return { bytes: new TextEncoder().encode(text), unmappable: 0 };
    case 'utf-8-bom': {
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf], 0);
      out.set(body, 3);
      return { bytes: out, unmappable: 0 };
    }
    case 'utf-16le':
    case 'utf-16be': {
      const le = encoding === 'utf-16le';
      const out = new Uint8Array(2 + text.length * 2);
      out[0] = le ? 0xff : 0xfe;
      out[1] = le ? 0xfe : 0xff;
      for (let i = 0; i < text.length; i += 1) {
        const unit = text.charCodeAt(i);
        const hi = unit >> 8;
        const lo = unit & 0xff;
        out[2 + i * 2] = le ? lo : hi;
        out[3 + i * 2] = le ? hi : lo;
      }
      return { bytes: out, unmappable: 0 };
    }
    case 'windows-1252': {
      const out: number[] = [];
      let unmappable = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0x3f;
        if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
          out.push(cp);
          continue;
        }
        const mapped = CP1252_REVERSE.get(cp);
        if (mapped !== undefined) {
          out.push(mapped);
        } else {
          out.push(0x3f);
          unmappable += 1;
        }
      }
      return { bytes: Uint8Array.from(out), unmappable };
    }
  }
}

/** Classify the line endings used in `text`. */
export function detectEol(text: string): EolKind {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (c === 0x0a) {
      lf += 1;
    }
  }
  const kinds = (lf > 0 ? 1 : 0) + (crlf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (cr > 0) return 'cr';
  return 'lf';
}
