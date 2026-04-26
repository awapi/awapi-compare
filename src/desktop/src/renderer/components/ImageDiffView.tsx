import { useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { type FileKindResult } from '@awapi/shared';
import { ImageSizeMismatchError, diffImages, rasterToDataUrl, type RasterImage } from '../imageDiff.js';

export interface ImageDiffViewProps {
  /** Raw bytes of the left image, or `null` when absent. */
  left: Uint8Array | null;
  /** Raw bytes of the right image, or `null` when absent. */
  right: Uint8Array | null;
  /** Sub-format reported by `classifyFile`. Used to pick the MIME type. */
  imageFormat?: FileKindResult['imageFormat'];
}

type Mode = 'side-by-side' | 'onion-skin' | 'pixel-diff';

/**
 * Image diff view. Three sub-modes:
 *  - "side-by-side": both images, no overlay.
 *  - "onion-skin":   right image overlaid on the left with an opacity slider.
 *  - "pixel-diff":   pixelmatch-rendered delta (red on transparent).
 *
 * Decoding happens via two `<img>` elements + a hidden `<canvas>` so we
 * can extract `ImageData` for `diffImages`. CSP allows `data:` URIs in
 * `img-src`, which is what we use to feed both bytes and diff buffers
 * back to the DOM.
 */
export function ImageDiffView({
  left,
  right,
  imageFormat,
}: ImageDiffViewProps): JSX.Element {
  const mime = mimeFor(imageFormat);
  const leftUrl = useDataUrl(left, mime);
  const rightUrl = useDataUrl(right, mime);

  const [mode, setMode] = useState<Mode>('side-by-side');
  const [opacity, setOpacity] = useState(0.5);
  const [leftRaster, setLeftRaster] = useState<RasterImage | null>(null);
  const [rightRaster, setRightRaster] = useState<RasterImage | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Decode both images to RGBA rasters once we have URLs.
  useEffect(() => {
    let cancelled = false;
    setDecodeError(null);
    void (async () => {
      try {
        const [l, r] = await Promise.all([
          leftUrl ? loadRaster(leftUrl) : Promise.resolve(null),
          rightUrl ? loadRaster(rightUrl) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setLeftRaster(l);
        setRightRaster(r);
      } catch (err) {
        if (!cancelled) setDecodeError(messageOf(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leftUrl, rightUrl]);

  const diffResult = useMemo(() => {
    if (!leftRaster || !rightRaster) return null;
    try {
      return diffImages(leftRaster, rightRaster);
    } catch (err) {
      if (err instanceof ImageSizeMismatchError) {
        return { sizeMismatch: true } as const;
      }
      throw err;
    }
  }, [leftRaster, rightRaster]);

  const diffUrl = useMemo(() => {
    if (!diffResult || 'sizeMismatch' in diffResult) return null;
    return rasterToDataUrl({
      width: diffResult.width,
      height: diffResult.height,
      data: diffResult.diff,
    });
  }, [diffResult]);

  return (
    <section className="awapi-imgdiff" aria-label="Image diff view">
      <header className="awapi-imgdiff__toolbar" role="toolbar" aria-label="Image diff modes">
        <ModeButton current={mode} mode="side-by-side" onSelect={setMode}>
          Side by side
        </ModeButton>
        <ModeButton current={mode} mode="onion-skin" onSelect={setMode} disabled={!leftUrl || !rightUrl}>
          Onion skin
        </ModeButton>
        <ModeButton current={mode} mode="pixel-diff" onSelect={setMode} disabled={!diffUrl}>
          Pixel diff
        </ModeButton>
        {mode === 'onion-skin' ? (
          <label className="awapi-imgdiff__opacity">
            Right overlay
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              aria-label="Onion-skin opacity"
            />
          </label>
        ) : null}
        {diffResult && !('sizeMismatch' in diffResult) ? (
          <span className="awapi-imgdiff__status">
            {diffResult.identical
              ? 'Images are pixel-identical'
              : `${diffResult.diffPixels} differing pixel${diffResult.diffPixels === 1 ? '' : 's'} (${(diffResult.diffRatio * 100).toFixed(2)}%)`}
          </span>
        ) : null}
        {diffResult && 'sizeMismatch' in diffResult ? (
          <span className="awapi-imgdiff__status awapi-imgdiff__status--warn">
            Sizes differ — pixel diff disabled.
          </span>
        ) : null}
        {decodeError ? (
          <span className="awapi-imgdiff__status awapi-imgdiff__status--warn">
            Decode failed: {decodeError}
          </span>
        ) : null}
      </header>
      <div className={`awapi-imgdiff__body awapi-imgdiff__body--${mode}`}>
        {mode === 'side-by-side' ? (
          <>
            <Pane label="Left" url={leftUrl} />
            <Pane label="Right" url={rightUrl} />
          </>
        ) : null}
        {mode === 'onion-skin' ? (
          <div className="awapi-imgdiff__onion">
            {leftUrl ? <img src={leftUrl} alt="left" /> : null}
            {rightUrl ? (
              <img src={rightUrl} alt="right" style={{ opacity }} className="awapi-imgdiff__onion-overlay" />
            ) : null}
          </div>
        ) : null}
        {mode === 'pixel-diff' ? (
          <div className="awapi-imgdiff__pixeldiff">
            {diffUrl ? <img src={diffUrl} alt="pixel diff" /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModeButton({
  current,
  mode,
  onSelect,
  children,
  disabled,
}: {
  current: Mode;
  mode: Mode;
  onSelect: (m: Mode) => void;
  children: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  const active = current === mode;
  return (
    <button
      type="button"
      className={`awapi-imgdiff__modebtn${active ? ' awapi-imgdiff__modebtn--active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(mode)}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Pane({ label, url }: { label: string; url: string | null }): JSX.Element {
  return (
    <div className="awapi-imgdiff__pane" aria-label={label}>
      <h3>{label}</h3>
      {url ? <img src={url} alt={label} /> : <p>(absent)</p>}
    </div>
  );
}

function useDataUrl(bytes: Uint8Array | null, mime: string): string | null {
  return useMemo(() => {
    if (!bytes) return null;
    return bytesToDataUrl(bytes, mime);
  }, [bytes, mime]);
}

/** Encode raw bytes as a `data:` URL of the given MIME type. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function mimeFor(format: FileKindResult['imageFormat']): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'png':
    default:
      return 'image/png';
  }
}

async function loadRaster(url: string): Promise<RasterImage> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context available');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: data.data };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = url;
  });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
