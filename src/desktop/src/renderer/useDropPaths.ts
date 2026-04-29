import { useCallback, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

export type DropSide = 'left' | 'right';

/**
 * Pure helper: given a pointer x position and the bounding rectangle
 * of a drop target, decide whether the drop targets the left or
 * right half. Exported for unit testing.
 */
export function sideFromPointer(
  clientX: number,
  rect: { left: number; width: number },
): DropSide {
  if (rect.width <= 0) return 'left';
  return clientX - rect.left < rect.width / 2 ? 'left' : 'right';
}

/**
 * Pure helper: extract on-disk paths from a `DataTransfer`. Uses
 * `window.awapi.getPathForFile` (Electron `webUtils.getPathForFile`)
 * to resolve each `File`. Empty strings (non-disk files) are dropped
 * from the result.
 */
export function extractDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const api = (globalThis as { awapi?: { app?: { getPathForFile?(f: File): string } } })
    .awapi;
  const getPath = api?.app?.getPathForFile;
  if (!getPath) return [];
  const out: string[] = [];
  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files.item(i);
    if (!file) continue;
    const p = getPath(file);
    if (p) out.push(p);
  }
  return out;
}

export interface UseDropPathsOptions {
  /**
   * Called when the user drops one or more file/folder paths onto
   * the wired element. `side` is determined by pointer x position
   * relative to the element's bounding box.
   */
  onDrop(side: DropSide, paths: string[]): void | Promise<void>;
  /** Disable drop handling (e.g. while a modal is open). */
  disabled?: boolean;
}

export interface UseDropPathsResult {
  /** Spread onto the drop-target element. */
  dropProps: {
    onDragOver(e: ReactDragEvent<HTMLElement>): void;
    onDragEnter(e: ReactDragEvent<HTMLElement>): void;
    onDragLeave(e: ReactDragEvent<HTMLElement>): void;
    onDrop(e: ReactDragEvent<HTMLElement>): void;
  };
  /** `'left' | 'right' | null` while a drag is hovering. */
  hoverSide: DropSide | null;
}

/**
 * React hook wiring drag-and-drop handlers for a split (left / right)
 * drop target. Determines the dropped side from pointer x position.
 */
export function useDropPaths(opts: UseDropPathsOptions): UseDropPathsResult {
  const [hoverSide, setHoverSide] = useState<DropSide | null>(null);
  const depthRef = useRef(0);

  const hasFiles = (e: ReactDragEvent<HTMLElement>): boolean => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  };

  const computeSide = (e: ReactDragEvent<HTMLElement>): DropSide => {
    const rect = e.currentTarget.getBoundingClientRect();
    return sideFromPointer(e.clientX, rect);
  };

  const onDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const next = computeSide(e);
      setHoverSide((prev) => (prev === next ? prev : next));
    },
    [opts.disabled],
  );

  const onDragEnter = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current += 1;
      setHoverSide(computeSide(e));
    },
    [opts.disabled],
  );

  const onDragLeave = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (opts.disabled) return;
      e.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setHoverSide(null);
    },
    [opts.disabled],
  );

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (opts.disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current = 0;
      setHoverSide(null);
      const side = computeSide(e);
      const paths = extractDroppedPaths(e.dataTransfer);
      if (paths.length === 0) return;
      void opts.onDrop(side, paths);
    },
    [opts],
  );

  return {
    dropProps: { onDragOver, onDragEnter, onDragLeave, onDrop },
    hoverSide,
  };
}
