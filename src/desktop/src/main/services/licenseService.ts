import type { LicenseActivateRequest, LicenseStatus } from '@awapi/shared';

import { NotImplementedError } from './errors.js';

/**
 * Licensing front door for the main process. Real implementation lands in
 * Phase 8 and delegates to `@awapi/licensing` (trial evaluator, Keygen
 * provider, safeStorage-backed token cache). The skeleton returns a
 * pessimistic "invalid" status so renderer code wiring up the banner
 * early can't accidentally unlock paid features.
 */
export class LicenseService {
  status(): Promise<LicenseStatus> {
    return Promise.resolve({ state: 'invalid' });
  }

  activate(_req: LicenseActivateRequest): Promise<LicenseStatus> {
    throw new NotImplementedError('license.activate', 'Phase 8');
  }

  deactivate(): Promise<void> {
    throw new NotImplementedError('license.deactivate', 'Phase 8');
  }
}
