import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';

/**
 * Narrow filesystem surface the hasher needs. Matches both `node:fs` and
 * memfs so tests can inject an in-memory volume.
 */
export interface HashFs {
  createReadStream(path: string, options?: unknown): NodeJS.ReadableStream;
}

/**
 * Streamed content hashing (SHA-256) used by thorough compare mode, plus
 * a streamed equality check for binary mode. Both run in constant memory
 * regardless of file size.
 */
export class HashService {
  constructor(private readonly fs: HashFs = nodeFs as unknown as HashFs) {}

  /** Stream the file and return its SHA-256 as a hex string. */
  hash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256');
      const s = this.fs.createReadStream(path);
      s.on('data', (chunk) => h.update(chunk as Buffer));
      s.on('end', () => resolve(h.digest('hex')));
      s.on('error', reject);
    });
  }

  /**
   * Stream both files and return `true` iff their byte contents match.
   * Implemented on top of `hash` so we never buffer whole files. A full
   * parallel byte-stream comparator is tracked for a later iteration
   * (see `todo/plan.md` Phase 4).
   */
  async bytesEqual(leftPath: string, rightPath: string): Promise<boolean> {
    const [lh, rh] = await Promise.all([this.hash(leftPath), this.hash(rightPath)]);
    return lh === rh;
  }
}
