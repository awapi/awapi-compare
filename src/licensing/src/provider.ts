import type { LicenseStatus } from '@awapi/shared';

export interface ActivationToken {
  /** Opaque token from provider (e.g., Keygen). Signed + verifiable offline. */
  token: string;
  /** Epoch ms when token expires; null = perpetual. */
  expiresAt: number | null;
  licensee?: string;
}

/**
 * Pluggable license provider. Default implementation talks to Keygen.sh.
 * A second implementation can target self-hosted or LemonSqueezy-direct.
 */
export interface LicenseProvider {
  /** Exchange a user-entered key for a signed activation token. */
  activate(key: string, installId: string): Promise<ActivationToken>;
  /** Re-check an existing token server-side (revocation, expiry). */
  validate(token: string, installId: string): Promise<LicenseStatus>;
  /** Release the current activation slot. */
  deactivate(token: string, installId: string): Promise<void>;
}
