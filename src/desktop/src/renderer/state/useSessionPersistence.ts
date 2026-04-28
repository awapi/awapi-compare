import { useEffect, useMemo } from 'react';

import { getSessionStore } from './sessionRegistry.js';

const SAVE_DEBOUNCE_MS = 800;

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
  const mode = useSession((s) => s.mode);
  const rules = useSession((s) => s.rules);
  const diffOptions = useSession((s) => s.diffOptions);

  useEffect(() => {
    if (!window.awapi?.session) return;
    if (!leftRoot && !rightRoot) return;

    const handle = setTimeout(() => {
      const snapshot = useSession.getState().toSnapshot();
      void window.awapi.session.save(snapshot).catch((err: unknown) => {
        console.warn('[awapi] session auto-save failed:', err);
      });
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // rules/diffOptions are objects; list them so deep changes trigger saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftRoot, rightRoot, mode, rules, diffOptions]);
}
