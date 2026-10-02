import type { AwapiApi, FolderSyncItem, FolderSyncPlan } from '@awapi/shared';
import { joinPath } from './paths.js';

export interface FolderSyncResult {
  /** Items that completed without error. */
  succeeded: number;
  /** Items that reported at least one error. */
  failed: number;
  errors: string[];
}

export interface RunFolderSyncOptions {
  leftRoot: string;
  rightRoot: string;
  fs: Pick<AwapiApi['fs'], 'copy' | 'rm'>;
  onProgress?(done: number, total: number): void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runItem(
  item: FolderSyncItem,
  { leftRoot, rightRoot, fs }: RunFolderSyncOptions,
): Promise<string[]> {
  switch (item.op) {
    case 'copy-left-to-right':
    case 'copy-right-to-left': {
      const [fromRoot, toRoot] =
        item.op === 'copy-left-to-right' ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
      const result = await fs.copy({
        from: joinPath(fromRoot, item.relPath),
        to: joinPath(toRoot, item.relPath),
        overwrite: item.overwrite,
      });
      return result.errors.map((e) => e.message);
    }
    case 'delete-left':
    case 'delete-right': {
      const root = item.op === 'delete-left' ? leftRoot : rightRoot;
      const result = await fs.rm({ paths: [joinPath(root, item.relPath)] });
      return result.errors.map((e) => e.message);
    }
  }
}

/**
 * Execute a {@link FolderSyncPlan} item by item. A failing item never stops
 * the run; its errors are collected so the user sees everything that went wrong.
 */
export async function runFolderSync(
  plan: FolderSyncPlan,
  options: RunFolderSyncOptions,
): Promise<FolderSyncResult> {
  if (!options.leftRoot.trim() || !options.rightRoot.trim()) {
    throw new Error('Both folder roots must be set before syncing.');
  }
  const result: FolderSyncResult = { succeeded: 0, failed: 0, errors: [] };
  const total = plan.items.length;
  let done = 0;
  for (const item of plan.items) {
    let errors: string[];
    try {
      errors = await runItem(item, options);
    } catch (err) {
      errors = [errorMessage(err)];
    }
    if (errors.length === 0) {
      result.succeeded += 1;
    } else {
      result.failed += 1;
      result.errors.push(...errors.map((m) => `${item.relPath}: ${m}`));
    }
    done += 1;
    options.onProgress?.(done, total);
  }
  return result;
}
