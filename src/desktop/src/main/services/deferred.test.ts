import { describe, expect, it } from 'vitest';

import { NotImplementedError } from './errors.js';
import { SftpService } from './sftpService.js';

describe('deferred service skeletons', () => {
  it('SftpService.connect throws NotImplementedError (deferred to v1.1)', () => {
    expect(() =>
      new SftpService().connect({ host: 'example.com', username: 'me', password: 'x' }),
    ).toThrow(NotImplementedError);
  });
});
