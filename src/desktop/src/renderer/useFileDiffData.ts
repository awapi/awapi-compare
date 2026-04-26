import { useCallback, useEffect, useState } from 'react';
import {
  LARGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  classifyFile,
  decodeUtf8,
  type FileKind,
} from '@awapi/shared';
import { extname } from './paths.js';

/**
 * Per-side load state for the file-diff tab. The hook returns a pair
 * (left + right) so the UI can render side-aware skeletons / errors.
 */
export interface SideData {
  /** Absolute path on disk. `null` when the side is absent in the pair. */
  path: string | null;
  /** Loading state. `'absent'` when the side wasn't part of the pair. */
  state: 'idle' | 'loading' | 'ready' | 'error' | 'absent' | 'too-large' | 'unconfirmed';
  /** Raw bytes (length === size). Set when `state === 'ready'`. */
  bytes?: Uint8Array;
  /** UTF-8 decode of `bytes`, only computed when the kind is `'text'`. */
  text?: string;
  /** Snapshot of the file's mtime at load time — used by the save flow. */
  mtimeMs?: number;
  /** Reported size in bytes, even when we declined to load it. */
  size?: number;
  /** Error message on `state === 'error'`. */
  error?: string;
}

export interface FileDiffData {
  left: SideData;
  right: SideData;
  /**
   * Joint kind classification. We pick whichever side loaded first; if
   * both loaded with conflicting verdicts, the caller can override per
   * side.
   */
  kind: FileKind | null;
  /** Re-trigger the load (e.g. after a save or external change). */
  reload: () => void;
  /** Confirm loading despite the large-file warning. */
  confirmLarge: () => void;
}

export interface UseFileDiffDataOptions {
  leftPath: string | null;
  rightPath: string | null;
  /** Extension used to assist the magic-byte sniff (e.g. `.png`). */
  extensionHint?: string;
  /**
   * When false (default), files larger than `largeFileBytes` block on
   * a confirmation; passing `true` bypasses the prompt (used by tests
   * and "Open anyway").
   */
  autoConfirmLarge?: boolean;
  largeFileBytes?: number;
  /** Test seam: stub for `window.awapi.fs`. */
  fsApi?: FsApi;
}

interface FsApi {
  read(req: { path: string; maxBytes?: number }): Promise<{
    data: Uint8Array;
    size: number;
    mtimeMs: number;
  }>;
  stat(req: { path: string }): Promise<{ size: number; mtimeMs: number; type: string }>;
}

const ABSENT: SideData = { path: null, state: 'absent' };

export function useFileDiffData(options: UseFileDiffDataOptions): FileDiffData {
  const {
    leftPath,
    rightPath,
    extensionHint,
    autoConfirmLarge,
    largeFileBytes = LARGE_FILE_BYTES,
    fsApi,
  } = options;
  const [left, setLeft] = useState<SideData>(initialSide(leftPath));
  const [right, setRight] = useState<SideData>(initialSide(rightPath));
  const [kind, setKind] = useState<FileKind | null>(null);
  const [generation, setGeneration] = useState(0);
  const [confirmedLarge, setConfirmedLarge] = useState(autoConfirmLarge === true);

  const reload = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  const confirmLarge = useCallback(() => {
    setConfirmedLarge(true);
    setGeneration((g) => g + 1);
  }, []);

  // Reload when paths change.
  useEffect(() => {
    setConfirmedLarge(autoConfirmLarge === true);
    setGeneration((g) => g + 1);
  }, [leftPath, rightPath, autoConfirmLarge]);

  useEffect(() => {
    let cancelled = false;
    const api = fsApi ?? (typeof window !== 'undefined' ? window.awapi?.fs : undefined);
    if (!api) {
      setLeft(initialSide(leftPath));
      setRight(initialSide(rightPath));
      setKind(null);
      return () => {
        cancelled = true;
      };
    }

    setLeft(leftPath ? { path: leftPath, state: 'loading' } : ABSENT);
    setRight(rightPath ? { path: rightPath, state: 'loading' } : ABSENT);

    void (async () => {
      const [l, r] = await Promise.all([
        loadSide(leftPath, api, largeFileBytes, confirmedLarge),
        loadSide(rightPath, api, largeFileBytes, confirmedLarge),
      ]);
      if (cancelled) return;
      setLeft(l);
      setRight(r);
      const sniffSource = pickSniffSource(l, r);
      const ext = extensionHint ?? extnameOfFirst(leftPath, rightPath);
      setKind(sniffSource ? classifyFile(sniffSource, ext).kind : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [generation]);

  // Decode text lazily — once we know the kind is 'text'.
  useEffect(() => {
    if (kind !== 'text') return;
    setLeft((prev) => decoded(prev));
    setRight((prev) => decoded(prev));
  }, [kind]);

  return { left, right, kind, reload, confirmLarge };
}

function initialSide(path: string | null): SideData {
  return path ? { path, state: 'idle' } : ABSENT;
}

async function loadSide(
  path: string | null,
  api: FsApi,
  largeFileBytes: number,
  confirmedLarge: boolean,
): Promise<SideData> {
  if (!path) return ABSENT;
  try {
    const stat = await api.stat({ path });
    if (stat.type !== 'file') {
      return { path, state: 'error', error: `Not a regular file (${stat.type})` };
    }
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return { path, state: 'too-large', size: stat.size, mtimeMs: stat.mtimeMs };
    }
    if (stat.size > largeFileBytes && !confirmedLarge) {
      return {
        path,
        state: 'unconfirmed',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    }
    const result = await api.read({ path });
    return {
      path,
      state: 'ready',
      bytes: result.data,
      size: result.size,
      mtimeMs: result.mtimeMs,
    };
  } catch (err) {
    return { path, state: 'error', error: messageOf(err) };
  }
}

function pickSniffSource(l: SideData, r: SideData): Uint8Array | null {
  if (l.state === 'ready' && l.bytes) return l.bytes;
  if (r.state === 'ready' && r.bytes) return r.bytes;
  return null;
}

function decoded(side: SideData): SideData {
  if (side.state !== 'ready' || !side.bytes || side.text !== undefined) return side;
  return { ...side, text: decodeUtf8(side.bytes) };
}

function extnameOfFirst(a: string | null, b: string | null): string {
  if (a) return extname(a);
  if (b) return extname(b);
  return '';
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
