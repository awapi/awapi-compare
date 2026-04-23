import { NotImplementedError } from './errors.js';

export interface CliInvocation {
  /** Absolute paths to the left and right roots. */
  left: string;
  right: string;
  mode?: 'quick' | 'thorough';
  rulesFile?: string;
}

/**
 * Bridges `src/cli` invocations to the running desktop app (or boots a
 * new instance pre-loaded with the requested session). Real
 * implementation lands in Phase 10.
 */
export class CliService {
  handoff(_invocation: CliInvocation): Promise<void> {
    throw new NotImplementedError('cli.handoff', 'Phase 10');
  }
}
