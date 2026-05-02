import { join } from 'node:path';

export interface RecentsFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, contents: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
}

export interface RecentsServiceDeps {
  /** Absolute path to the JSON file, e.g. `<userData>/recents.json`. */
  filePath?: string;
  /** Directory of `filePath`; created when missing. */
  dirPath?: string;
  /** Injectable `fs.promises`. */
  fs?: RecentsFs;
}

/**
 * Persists the recent-paths map to `<userData>/recents.json`.
 * Without deps the service runs in memory only (tests, CLI).
 */
export class RecentsService {
  private data: Record<string, string[]> = {};
  private loaded = false;

  constructor(private readonly deps: RecentsServiceDeps = {}) {}

  private async load(): Promise<void> {
    this.loaded = true;
    if (!this.deps.filePath || !this.deps.fs) {
      this.data = {};
      return;
    }
    try {
      const raw = await this.deps.fs.readFile(this.deps.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          result[k] = v.filter((x): x is string => typeof x === 'string');
        }
      }
      this.data = result;
    } catch (err) {
      if (isNotFound(err)) {
        this.data = {};
        return;
      }
      console.warn('[recents] failed to load recents.json; starting empty:', err);
      this.data = {};
    }
  }

  async get(): Promise<Record<string, string[]>> {
    if (!this.loaded) await this.load();
    return { ...this.data };
  }

  async set(data: Record<string, string[]>): Promise<void> {
    this.data = { ...data };
    this.loaded = true;
    if (!this.deps.filePath || !this.deps.fs) return;
    if (this.deps.dirPath) {
      try {
        await this.deps.fs.mkdir(this.deps.dirPath, { recursive: true });
      } catch {
        // best-effort
      }
    }
    await this.deps.fs.writeFile(
      this.deps.filePath,
      JSON.stringify(this.data, null, 2),
      'utf8',
    );
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
