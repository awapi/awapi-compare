import pixelmatch from 'pixelmatch';

/**
 * Subset of `ImageData` that the diff function actually needs. Lets us
 * unit-test the wrapper without depending on a real `<canvas>` (which
 * jsdom only emulates partially).
 */
export interface RasterImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major, top-down. Length must equal `width*height*4`. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface ImageDiffOptions {
  /**
   * Anti-aliasing tolerance, 0..1 — directly forwarded to `pixelmatch`.
   * Defaults to `0.1` (matches pixelmatch's own default).
   */
  threshold?: number;
  /** When true, anti-aliased pixels are not counted as different. */
  includeAA?: boolean;
}

export interface ImageDiffResult {
  width: number;
  height: number;
  /** RGBA buffer of the rendered diff (red where pixels differ). */
  diff: Uint8ClampedArray;
  /** Number of pixels that differed beyond the threshold. */
  diffPixels: number;
  /** `diffPixels / (width*height)` in the inclusive range [0, 1]. */
  diffRatio: number;
  /** True iff `diffPixels === 0`. */
  identical: boolean;
}

export class ImageSizeMismatchError extends Error {
  constructor(
    readonly leftSize: { width: number; height: number },
    readonly rightSize: { width: number; height: number },
  ) {
    super(
      `pixelmatch requires equal-sized rasters (` +
        `left ${leftSize.width}x${leftSize.height}, ` +
        `right ${rightSize.width}x${rightSize.height})`,
    );
    this.name = 'ImageSizeMismatchError';
  }
}

/**
 * Compute a per-pixel difference between two equally-sized rasters.
 * Throws {@link ImageSizeMismatchError} on size mismatch — callers
 * should surface a user-friendly message and skip the pixel diff.
 */
export function diffImages(
  left: RasterImage,
  right: RasterImage,
  options: ImageDiffOptions = {},
): ImageDiffResult {
  if (left.width !== right.width || left.height !== right.height) {
    throw new ImageSizeMismatchError(
      { width: left.width, height: left.height },
      { width: right.width, height: right.height },
    );
  }
  const { width, height } = left;
  if (left.data.length !== width * height * 4) {
    throw new Error('diffImages: left.data length does not match width*height*4');
  }
  if (right.data.length !== width * height * 4) {
    throw new Error('diffImages: right.data length does not match width*height*4');
  }

  const diff = new Uint8ClampedArray(width * height * 4);
  const leftClamped = toClamped(left.data);
  const rightClamped = toClamped(right.data);
  const diffPixels = pixelmatch(leftClamped, rightClamped, diff, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: options.includeAA === true,
  });
  const total = width * height;
  return {
    width,
    height,
    diff,
    diffPixels,
    diffRatio: total === 0 ? 0 : diffPixels / total,
    identical: diffPixels === 0,
  };
}

function toClamped(buf: Uint8Array | Uint8ClampedArray): Uint8ClampedArray {
  if (buf instanceof Uint8ClampedArray) return buf;
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Convert a {@link RasterImage} diff buffer into a `data:` URL via a
 * detached `<canvas>`. Returns `null` when running outside a DOM (so
 * unit tests can call us safely).
 */
export function rasterToDataUrl(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const id = ctx.createImageData(image.width, image.height);
  id.data.set(image.data);
  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL('image/png');
}
