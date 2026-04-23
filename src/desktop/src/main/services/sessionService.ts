import type { Session } from '@awapi/shared';

import { NotImplementedError } from './errors.js';

/**
 * Session save/load/list. Real implementation (disk persistence under
 * `userData/sessions/`) lands alongside Phase 5 renderer work. The
 * skeleton stores sessions in memory so the UI can wire up early.
 */
export class SessionService {
  private readonly sessions = new Map<string, Session>();

  save(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
    return Promise.resolve();
  }

  load(id: string): Promise<Session | null> {
    const s = this.sessions.get(id);
    return Promise.resolve(s ? { ...s } : null);
  }

  list(): Promise<Session[]> {
    return Promise.resolve([...this.sessions.values()].map((s) => ({ ...s })));
  }

  /** Persist sessions to disk. Implemented alongside Phase 5. */
  flush(): Promise<void> {
    throw new NotImplementedError('session.flush', 'Phase 5');
  }
}
