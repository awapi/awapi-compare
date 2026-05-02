import { disposeSessionStore } from './sessionRegistry.js';
import { createPreferencesStore } from './preferencesStore.js';
import { createRecentsStore } from './recentsStore.js';
import { createRulesStore } from './rulesStore.js';
import { createThemeStore } from './themeStore.js';
import { createWorkspaceStore } from './workspaceStore.js';

/**
 * Runtime singletons. The underlying `create*Store` functions remain
 * factories (so tests can spin up isolated stores), but the renderer
 * needs **one** shared instance per process — exported here.
 *
 * Per-tab compare-session stores are managed separately via
 * `sessionRegistry.ts`. Closing a tab here disposes its session store.
 */
export const useWorkspaceStore = createWorkspaceStore({
  onTabClosed: (tab) => {
    if (tab.kind === 'compare') {
      disposeSessionStore(tab.id);
    }
  },
});

export const useThemeStore = createThemeStore();
export const useRulesStore = createRulesStore();
export const usePreferencesStore = createPreferencesStore();
export const useRecentsStore = createRecentsStore({
  storage: null,
  onSave: (map) => {
    void window.awapi?.recents
      ?.set(map as Record<string, string[]>)
      .catch(() => {});
  },
});
