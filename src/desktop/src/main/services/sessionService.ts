import { join } from 'node:path';

import type { Session } from '@awapi/shared';

export interface SessionFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, contents: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  readdir(path: string): Promise<string[]>;
}

export interface SessionServiceDeps {
  /**
   * Directory under which individual session snapshots are stored as
   * `<id>.json` files. Typically `<userData>/sessions`. When omitted,
   * the service runs in memory only — useful for tests and CLI contexts.
   */
  dirPath?: string;
  /** Injectable `fs.promises`. Defaults to in-memory only when omitted. */
  fs?: SessionFs;
}

/**
 * Session save/load/list with optional disk persistence.
 * When {@link SessionServiceDeps.dirPath} and {@link SessionServiceDeps.fs}
 * are provided, each session is written to `<dirPath>/<id>.json` on save
 * and read back on load/list. Without deps the service operates in memory
 * (backwards-compatible with existing tests).
 */
export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly deps: SessionServiceDeps;

  constructor(deps: SessionServiceDeps = {}) {
    this.deps = deps;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
    if (this.deps.dirPath && this.deps.fs) {
      await this.deps.fs.mkdir(this.deps.dirPath, { recursive: true });
      await this.deps.fs.writeFile(
        join(this.deps.dirPath, `${session.id}.json`),
        JSON.stringify(session, null, 2),
        'utf8',
      );
    }
  }

  async load(id: string): Promise<Session | null> {
    const cached = this.sessions.get(id);
    if (cached) return { ...cached };
    if (this.deps.dirPath && this.deps.fs) {
      try {
        const raw = await this.deps.fs.readFile(
          join(this.deps.dirPath, `${id}.json`),
          'utf8',
        );
        const s = JSON.parse(raw) as Session;
        this.sessions.set(s.id, { ...s });
        return { ...s };
      } catch {
        return null;
      }
    }
    return null;
  }

  async list(): Promise<Session[]> {
    if (this.deps.dirPath && this.deps.fs) {
      let files: string[];
      try {
        files = await this.deps.fs.readdir(this.deps.dirPath);
      } catch {
        return [...this.sessions.values()].map((s) => ({ ...s }));
      }
      const results: Session[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.deps.fs.readFile(
            join(this.deps.dirPath, file),
            'utf8',
          );
          const s = JSON.parse(raw) as Session;
          this.sessions.set(s.id, { ...s });
          results.push({ ...s });
        } catch {
          // skip corrupt or unreadable files
        }
      }
      return results;
    }
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }

  /** No-op: save() writes through immediately. */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}
