import { create } from 'zustand';

export type TabKind = 'compare' | 'fileDiff';

export interface CompareTab {
  id: string;
  kind: 'compare';
  title: string;
}

export interface FileDiffTab {
  id: string;
  kind: 'fileDiff';
  title: string;
  /** Pair-key (relPath) the tab is bound to. */
  relPath: string;
}

export type WorkspaceTab = CompareTab | FileDiffTab;

export const COMPARE_TAB_ID = 'compare';

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;

  setActiveTab(id: string): void;
  /**
   * Open (or focus) a file-diff tab for the given pair. Tabs are
   * de-duplicated by `relPath`. Returns the tab id.
   */
  openFileDiffTab(relPath: string, title?: string): string;
  closeTab(id: string): void;
  /**
   * Close every tab except the always-present compare tab.
   */
  closeAllFileDiffTabs(): void;
}

export interface CreateWorkspaceStoreOptions {
  generateId?: () => string;
  initialTabs?: WorkspaceTab[];
  initialActiveTabId?: string;
}

function defaultGenerateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function defaultTitleFor(relPath: string): string {
  if (!relPath) return 'File diff';
  const parts = relPath.split(/[\\/]/u).filter((p) => p.length > 0);
  return parts.length === 0 ? relPath : (parts[parts.length - 1] ?? relPath);
}

export function createWorkspaceStore(opts: CreateWorkspaceStoreOptions = {}) {
  const generateId = opts.generateId ?? defaultGenerateId;
  const initialTabs: WorkspaceTab[] =
    opts.initialTabs ?? [{ id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' }];
  const initialActiveTabId = opts.initialActiveTabId ?? initialTabs[0]?.id ?? COMPARE_TAB_ID;

  return create<WorkspaceState>((set, get) => ({
    tabs: initialTabs,
    activeTabId: initialActiveTabId,

    setActiveTab: (id) => {
      const exists = get().tabs.some((t) => t.id === id);
      if (!exists) return;
      set({ activeTabId: id });
    },

    openFileDiffTab: (relPath, title) => {
      const existing = get().tabs.find(
        (t): t is FileDiffTab => t.kind === 'fileDiff' && t.relPath === relPath,
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
      const id = generateId();
      const tab: FileDiffTab = {
        id,
        kind: 'fileDiff',
        relPath,
        title: title ?? defaultTitleFor(relPath),
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      return id;
    },

    closeTab: (id) => {
      if (id === COMPARE_TAB_ID) return;
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        // Prefer the previous tab; fall back to the compare tab.
        const fallback = next[idx - 1] ?? next[idx] ?? next[0];
        nextActive = fallback?.id ?? COMPARE_TAB_ID;
      }
      set({ tabs: next, activeTabId: nextActive });
    },

    closeAllFileDiffTabs: () =>
      set((s) => ({
        tabs: s.tabs.filter((t) => t.kind === 'compare'),
        activeTabId: COMPARE_TAB_ID,
      })),
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
