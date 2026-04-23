import { NotImplementedError } from './errors.js';

export interface SftpConnectRequest {
  host: string;
  port?: number;
  username: string;
  /** Password OR privateKey path; exact contract solidifies in v1.1. */
  password?: string;
  privateKeyPath?: string;
}

/**
 * SFTP remote folder compare. Deferred to v1.1 — this skeleton exists
 * so the IPC channel and interface are reserved. All methods throw
 * `NotImplementedError` until then.
 */
export class SftpService {
  connect(_req: SftpConnectRequest): Promise<void> {
    throw new NotImplementedError('sftp.connect', 'v1.1');
  }
}
