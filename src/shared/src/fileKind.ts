/**
 * File-kind classifier for the file-diff view.
 *
 * Picks one of `'text' | 'image' | 'binary'` based on (a) a small magic
 * sniff over the first few bytes for known image formats and (b) a
 * heuristic over the rest of the buffer to decide whether the
 * remaining bytes are valid UTF-8 / printable text.
 *
 * Pure & dependency-free — lives in `@awapi/shared` so the renderer
 * and tests can import it without pulling Node APIs.
 *
 * Used by {@link FileDiffTab} to pick the right viewer and by the
 * "large file" warning to decide which size threshold applies.
 */

export type FileKind = 'text' | 'image' | 'binary';

export interface FileKindResult {
  kind: FileKind;
  /** Concrete sub-format when the kind was determined by magic bytes. */
  imageFormat?: 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';
}

/** Soft warning threshold for any file kind, in bytes (default 5 MiB). */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

/** Hard cap for full reads (default 50 MiB). Above this, only chunked reads are allowed. */
export const MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024;

/** How many bytes to inspect before giving up on text classification. */
const TEXT_SAMPLE_LIMIT = 4096;

/**
 * Classify a file. The optional `extensionHint` is the file's extension
 * including the leading `.` (e.g. `.png`); it is used as a tiebreaker
 * when the magic-byte sniff is inconclusive (small or empty file).
 */
export function classifyFile(
  buf: Uint8Array,
  extensionHint?: string,
): FileKindResult {
  const image = detectImage(buf);
  if (image) return { kind: 'image', imageFormat: image };

  if (buf.length === 0) {
    const ext = (extensionHint ?? '').toLowerCase();
    if (TEXTUAL_EXTENSIONS.has(ext)) return { kind: 'text' };
    return { kind: 'text' }; // empty files are conventionally treated as text.
  }

  if (looksLikeText(buf)) return { kind: 'text' };
  return { kind: 'binary' };
}

/**
 * Decode a UTF-8 byte buffer to a string, using a streaming decoder
 * that tolerates the BOM and replaces malformed sequences with the
 * Unicode replacement character. Mirrors what Monaco does when it
 * loads a file from disk, so the renderer never sees raw bytes.
 */
export function decodeUtf8(buf: Uint8Array): string {
  // Strip a BOM if present — Monaco renders it as a stray glyph.
  const start = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  const view = start === 0 ? buf : buf.subarray(start);
  return new TextDecoder('utf-8', { fatal: false }).decode(view);
}

// ---- internals ---------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;
const BMP = [0x42, 0x4d] as const;

function detectImage(buf: Uint8Array): FileKindResult['imageFormat'] | null {
  if (matches(buf, PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (matches(buf, GIF87) || matches(buf, GIF89)) return 'gif';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }
  if (matches(buf, BMP)) return 'bmp';
  return null;
}

function matches(buf: Uint8Array, sig: readonly number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Heuristic text test:
 * - reject if a NUL byte occurs in the first sample window;
 * - reject if more than 5% of the first sample window is non-printable
 *   non-whitespace control bytes;
 * - otherwise accept.
 */
function looksLikeText(buf: Uint8Array): boolean {
  const limit = Math.min(buf.length, TEXT_SAMPLE_LIMIT);
  let suspicious = 0;
  for (let i = 0; i < limit; i += 1) {
    const b = buf[i] ?? 0;
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      suspicious += 1;
    }
  }
  return suspicious / Math.max(1, limit) < 0.05;
}

const TEXTUAL_EXTENSIONS = new Set<string>([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.svg',
  '.csv',
  '.log',
  '.ini',
  '.conf',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.fs',
  '.php',
  '.sql',
  '.gitignore',
  '.editorconfig',
  '.env',
]);

/**
 * Pick a Monaco editor `language` id from a path / extension. Returns
 * `'plaintext'` for unknown extensions.
 */
export function languageFromPath(path: string): string {
  const ext = extensionOf(path);
  return MONACO_LANG_BY_EXT[ext] ?? 'plaintext';
}

function extensionOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.toLowerCase();
  return base.slice(dot).toLowerCase();
}

const MONACO_LANG_BY_EXT: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.sh': 'shell',
  '.bash': 'shell',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini',
  '.dockerfile': 'dockerfile',
};
