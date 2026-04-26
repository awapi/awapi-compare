import { describe, expect, it } from 'vitest';
import { ImageSizeMismatchError, diffImages, type RasterImage } from './imageDiff.js';

function solid(width: number, height: number, rgba: [number, number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4 + 0] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}

describe('diffImages', () => {
  it('reports identical=true and diffPixels=0 for byte-identical rasters', () => {
    const a = solid(4, 4, [10, 20, 30, 255]);
    const b = solid(4, 4, [10, 20, 30, 255]);
    const r = diffImages(a, b);
    expect(r.identical).toBe(true);
    expect(r.diffPixels).toBe(0);
    expect(r.diffRatio).toBe(0);
    expect(r.width).toBe(4);
    expect(r.height).toBe(4);
    expect(r.diff).toHaveLength(64);
  });

  it('reports every pixel as different when colours diverge fully', () => {
    const a = solid(2, 2, [0, 0, 0, 255]);
    const b = solid(2, 2, [255, 255, 255, 255]);
    const r = diffImages(a, b);
    expect(r.identical).toBe(false);
    expect(r.diffPixels).toBe(4);
    expect(r.diffRatio).toBe(1);
  });

  it('reports a partial diff when only some pixels differ', () => {
    const a = solid(2, 1, [0, 0, 0, 255]);
    const b = solid(2, 1, [0, 0, 0, 255]);
    // Flip the second pixel to white.
    b.data[4] = 255;
    b.data[5] = 255;
    b.data[6] = 255;
    const r = diffImages(a, b);
    expect(r.diffPixels).toBe(1);
    expect(r.diffRatio).toBe(0.5);
  });

  it('throws ImageSizeMismatchError when sizes differ', () => {
    const a = solid(2, 2, [0, 0, 0, 255]);
    const b = solid(3, 2, [0, 0, 0, 255]);
    expect(() => diffImages(a, b)).toThrow(ImageSizeMismatchError);
  });

  it('throws when the data buffer length contradicts the declared size', () => {
    const broken: RasterImage = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    const ok = solid(2, 2, [0, 0, 0, 255]);
    expect(() => diffImages(broken, ok)).toThrow(/length/);
    expect(() => diffImages(ok, broken)).toThrow(/length/);
  });

  it('accepts raw Uint8Array (RGBA) input', () => {
    const a = solid(1, 1, [1, 2, 3, 255]);
    const bData = new Uint8Array(4);
    bData[0] = 1;
    bData[1] = 2;
    bData[2] = 3;
    bData[3] = 255;
    const r = diffImages(a, { width: 1, height: 1, data: bData });
    expect(r.identical).toBe(true);
  });

  it('handles zero-sized rasters as identical with diffRatio=0', () => {
    const empty: RasterImage = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const r = diffImages(empty, empty);
    expect(r.identical).toBe(true);
    expect(r.diffRatio).toBe(0);
  });
});
