import { NotImplementedError } from './errors.js';

export interface UpdaterCheckResult {
  available: boolean;
  version?: string;
}

/**
 * `electron-updater` wrapper. Real implementation lands in Phase 9 and
 * targets the private GitHub Releases repo `awapi/awapi-compare`.
 */
export class UpdaterService {
  check(): Promise<UpdaterCheckResult> {
    return Promise.resolve({ available: false });
  }

  download(): Promise<void> {
    throw new NotImplementedError('updater.download', 'Phase 9');
  }

  install(): Promise<void> {
    throw new NotImplementedError('updater.install', 'Phase 9');
  }
}
