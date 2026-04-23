/**
 * Thrown by service skeletons whose real implementation is deferred to a
 * later phase in `todo/plan.md`. Callers (and IPC handlers) can catch this
 * and surface a "coming soon" message to the renderer without crashing.
 */
export class NotImplementedError extends Error {
  readonly phase: string;

  constructor(feature: string, phase: string) {
    super(`${feature} is not implemented yet (deferred to ${phase}).`);
    this.name = 'NotImplementedError';
    this.phase = phase;
  }
}
