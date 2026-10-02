import { describe, expect, it } from 'vitest';

import { mergeExitCode } from './mergeExit.js';

describe('mergeExitCode', () => {
  it('is 0 when the output was created or modified', () => {
    expect(mergeExitCode(null, { mtimeMs: 5, size: 1 })).toBe(0);
    expect(mergeExitCode({ mtimeMs: 1, size: 1 }, { mtimeMs: 2, size: 1 })).toBe(0);
    expect(mergeExitCode({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 9 })).toBe(0);
  });

  it('is 1 when the output is untouched or missing', () => {
    expect(mergeExitCode({ mtimeMs: 1, size: 1 }, { mtimeMs: 1, size: 1 })).toBe(1);
    expect(mergeExitCode(null, null)).toBe(1);
    expect(mergeExitCode({ mtimeMs: 1, size: 1 }, null)).toBe(1);
  });
});
