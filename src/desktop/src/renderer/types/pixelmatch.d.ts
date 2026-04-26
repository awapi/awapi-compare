/**
 * Minimal ambient declaration for pixelmatch v6. The package ships
 * ESM but no `.d.ts`. We keep this scoped to the call signature we
 * actually use in `imageDiff.ts`.
 */
declare module 'pixelmatch' {
  export interface PixelmatchOptions {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
    aaColor?: [number, number, number];
    diffColor?: [number, number, number];
    diffColorAlt?: [number, number, number] | null;
    diffMask?: boolean;
  }

  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray,
    img2: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray | null,
    width: number,
    height: number,
    options?: PixelmatchOptions,
  ): number;
}
