import { useEffect, useMemo, useRef } from 'react';

import { getSessionStore } from './sessionRegistry.js';

const SAVE_DEBOUNCE_MS = 800;

function basename(p: string): string {
  const cleaned = p.replace(/[\\/]+$/u, '');
  const parts = cleaned.split(/[\\/]/u).filter(Boolean);
  return parts.length === 0 ? cleaned : (parts[parts.length - 1] ?? cleaned);
}

/**
 * Auto-saves the session snapshot to disk whenever the compare config
 * (roots, mode, rules, diffOptions) changes. Skips saving when both
 * roots are empty so a brand-new tab doesn't overwrite a previously
 * persisted session before the restore has had a chance to run.
 */
export function useSessionPersistence(tabId: string): void {
  const useSession = useMemo(() => getSessionStore(tabId), [tabId]);

  const leftRoot = useSession((s) => s.leftRoot);
  const rightRoot = useSession((s) => s.rightRoot);
  const name = useSession((s) => s.name);
  const mode = useSession((s) => s.mode);
  const rules = useSession((s) => s.rules);
  const diffOptions = useSession((s) => s.diffOptions);

  // Tracks whether the current render was triggered by our own setName call
  // inside the timeout, so we can skip the redundant second save.
  const autoNamedRef = useRef(false);

  useEffect(() => {
    if (!window.awapi?.session) return;
    if (!leftRoot && !rightRoot) return;

    if (autoNamedRef.current) {
      autoNamedRef.current = false;
      return;
    }

    const handle = setTimeout(() => {
      const store = useSession.getState();
      if (!store.name) {
        const left = basename(leftRoot);
        const right = basename(rightRoot);
        if (left && right) {
          autoNamedRef.current = true;
          store.setName(`${left} ↔ ${right}`);
        }
      }
      const snapshot = store.toSnapshot();
      void window.awapi.session.save(snapshot).catch((err: unknown) => {
        console.warn('[awapi] session auto-save failed:', err);
      });
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // rules/diffOptions are objects; list them so deep changes trigger saves.
  }, [leftRoot, rightRoot, name, mode, rules, diffOptions]);
}
