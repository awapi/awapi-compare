import { join } from 'node:path';

import type { Session } from '@awapi/shared';

export interface SessionFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, contents: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
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
const MAX_SESSIONS = 10;

export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly deps: SessionServiceDeps;
  private diskLoaded = false;

  constructor(deps: SessionServiceDeps = {}) {
    this.deps = deps;
  }

  private async ensureDiskLoaded(): Promise<void> {
    if (this.diskLoaded || !this.deps.dirPath || !this.deps.fs) return;
    this.diskLoaded = true;
    try {
      const files = await this.deps.fs.readdir(this.deps.dirPath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await this.deps.fs.readFile(join(this.deps.dirPath, file), 'utf8');
          const s = JSON.parse(raw) as Session;
          if (!this.sessions.has(s.id)) this.sessions.set(s.id, { ...s });
        } catch {
          // skip corrupt files
        }
      }
    } catch {
      // dir doesn't exist yet
    }
  }

  async save(session: Session): Promise<void> {
    await this.ensureDiskLoaded();
    const duplicate = [...this.sessions.values()].find(
      (s) => s.id !== session.id && s.leftRoot === session.leftRoot && s.rightRoot === session.rightRoot,
    );
    if (duplicate) return;

    this.sessions.set(session.id, { ...session });
    if (this.deps.dirPath && this.deps.fs) {
      await this.deps.fs.mkdir(this.deps.dirPath, { recursive: true });
      await this.deps.fs.writeFile(
        join(this.deps.dirPath, `${session.id}.json`),
        JSON.stringify(session, null, 2),
        'utf8',
      );
    }

    if (this.sessions.size > MAX_SESSIONS) {
      const sorted = [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const old of sorted.slice(MAX_SESSIONS)) {
        this.sessions.delete(old.id);
        if (this.deps.dirPath && this.deps.fs) {
          await this.deps.fs.unlink(join(this.deps.dirPath, `${old.id}.json`)).catch(() => {});
        }
      }
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

  async delete(id: string): Promise<void> {
    await this.ensureDiskLoaded();
    this.sessions.delete(id);
    if (this.deps.dirPath && this.deps.fs) {
      await this.deps.fs.unlink(join(this.deps.dirPath, `${id}.json`)).catch(() => {});
    }
  }

  /** No-op: save() writes through immediately. */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}
