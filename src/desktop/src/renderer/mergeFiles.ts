import {
  FS_ERROR_EXTERNAL_MODIFICATION,
  classifyFile,
  decodeTextFile,
  encodeText,
  encodingLabel,
  languageFromPath,
  mergeTexts,
  type Eol,
  type Merge3Result,
  type TextEncodingId,
} from '@awapi/shared';
import { extname } from './paths.js';

/** The slice of `window.awapi.fs` the merge flow needs (injectable for tests). */
export interface MergeFsApi {
  read(req: { path: string }): Promise<{ data: Uint8Array; size: number; mtimeMs: number }>;
  stat(req: { path: string }): Promise<{ size: number; mtimeMs: number; type: string }>;
  write(req: {
    path: string;
    contents: string | Uint8Array;
    encoding?: 'utf8' | 'binary';
    expectedMtimeMs?: number;
  }): Promise<void>;
}

export interface MergeInputPaths {
  base: string;
  left: string;
  right: string;
  output: string;
}

export interface LoadedMerge {
  merge: Merge3Result;
  eol: Eol;
  finalNewline: boolean;
  /** Monaco language id used for all four panes. */
  language: string;
  /** Encoding the result is written with (the existing output's, else the left file's). */
  outputEncoding: TextEncodingId;
  /** mtime of the output file when loaded; `undefined` when it does not exist yet. */
  outputMtimeMs?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readText(
  label: string,
  path: string,
  fs: MergeFsApi,
): Promise<{ text: string; encoding: TextEncodingId }> {
  let data: Uint8Array;
  try {
    data = (await fs.read({ path })).data;
  } catch (err) {
    throw new Error(`${label}: ${messageOf(err)}`);
  }
  if (classifyFile(data, extname(path)).kind !== 'text') {
    throw new Error(`${label}: ${path} is not a text file`);
  }
  return decodeTextFile(data);
}

/**
 * Read the three inputs (an empty base path means "no common ancestor":
 * everything either side contains counts as added) and compute the merge.
 * The output file is only inspected for its encoding and mtime.
 */
export async function loadMerge(paths: MergeInputPaths, fs: MergeFsApi): Promise<LoadedMerge> {
  if (!paths.left.trim() || !paths.right.trim()) {
    throw new Error('Choose both a left and a right file.');
  }
  const [left, right, base] = await Promise.all([
    readText('Left', paths.left, fs),
    readText('Right', paths.right, fs),
    paths.base.trim() ? readText('Base', paths.base, fs) : Promise.resolve({ text: '' }),
  ]);

  let outputEncoding = left.encoding;
  let outputMtimeMs: number | undefined;
  if (paths.output.trim()) {
    try {
      const out = await fs.read({ path: paths.output });
      outputMtimeMs = out.mtimeMs;
      outputEncoding = decodeTextFile(out.data).encoding;
    } catch {
      // The output may not exist yet; it will be created on save.
    }
  }

  const { merge, eol, finalNewline } = mergeTexts(base.text, left.text, right.text);
  return {
    merge,
    eol,
    finalNewline,
    language: languageFromPath(paths.output.trim() || paths.left),
    outputEncoding,
    ...(outputMtimeMs !== undefined ? { outputMtimeMs } : {}),
  };
}

export type SaveMergeOutcome =
  | { ok: true; mtimeMs?: number }
  | { ok: false; reason: 'external-modification' | 'error'; message: string };

/**
 * Write the merged text. Non-UTF-8 encodings are encoded here and written
 * as raw bytes so the file keeps its encoding; an unrepresentable
 * character aborts the save rather than corrupting it.
 */
export async function saveMergeResult(
  text: string,
  encoding: TextEncodingId,
  outputPath: string,
  expectedMtimeMs: number | undefined,
  fs: MergeFsApi,
): Promise<SaveMergeOutcome> {
  let contents: string | Uint8Array = text;
  let writeEncoding: 'utf8' | 'binary' = 'utf8';
  if (encoding !== 'utf-8') {
    const encoded = encodeText(text, encoding);
    if (encoded.unmappable > 0) {
      return {
        ok: false,
        reason: 'error',
        message:
          `Cannot save as ${encodingLabel(encoding)}: ${encoded.unmappable} character(s) ` +
          'cannot be represented.',
      };
    }
    contents = encoded.bytes;
    writeEncoding = 'binary';
  }
  try {
    await fs.write({
      path: outputPath,
      contents,
      encoding: writeEncoding,
      ...(expectedMtimeMs !== undefined ? { expectedMtimeMs } : {}),
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      ok: false,
      reason: code === FS_ERROR_EXTERNAL_MODIFICATION ? 'external-modification' : 'error',
      message: messageOf(err),
    };
  }
  try {
    return { ok: true, mtimeMs: (await fs.stat({ path: outputPath })).mtimeMs };
  } catch {
    return { ok: true };
  }
}
