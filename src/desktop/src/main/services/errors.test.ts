import { describe, expect, it } from 'vitest';

import { NotImplementedError } from './errors.js';

describe('NotImplementedError', () => {
  it('carries the feature name, phase, and readable message', () => {
    const err = new NotImplementedError('fs.scan', 'Phase 4');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotImplementedError');
    expect(err.phase).toBe('Phase 4');
    expect(err.message).toContain('fs.scan');
    expect(err.message).toContain('Phase 4');
  });
});
