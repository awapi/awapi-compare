import { create } from 'zustand';

export type TabKind = 'compare' | 'fileDiff';

export interface CompareTab {
  id: string;
  kind: 'compare';
  title: string;
  /**
   * True when the tab has unsaved edits. Rendered as a leading `*`
   * marker on the tab title (VS Code-style).
   */
  dirty?: boolean;
}

export interface FileDiffTab {
  id: string;
  kind: 'fileDiff';
  title: string;
  /** Pair-key (relPath) the tab is bound to. */
  relPath: string;
  /**
   * Id of the compare tab whose scan opened this file-diff. The
   * file-diff component reads its pair from that tab's session store.
   */
  parentCompareTabId?: string;
  /**
   * True when the tab has unsaved edits. Rendered as a leading `*`
   * marker on the tab title (VS Code-style).
   */
  dirty?: boolean;
}

export type WorkspaceTab = CompareTab | FileDiffTab;

/**
 * Stable id for the **initial** compare tab created on app launch.
 * Additional compare tabs get generated ids. This constant remains
 * exported for tests and for menu shortcuts that target "the first
 * session".
 */
export const COMPARE_TAB_ID = 'compare';

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;

  setActiveTab(id: string): void;
  /**
   * Open (or focus) a file-diff tab for the given pair. Tabs are
   * de-duplicated by `relPath`. Returns the tab id.
   */
  openFileDiffTab(
    relPath: string,
    title?: string,
    parentCompareTabId?: string,
  ): string;
  /**
   * Open a brand-new (empty) compare tab and focus it. Returns the new
   * tab id. The actual compare-session state lives in the session
   * registry, keyed by this id.
   */
  openCompareTab(title?: string): string;
  /**
   * Update the displayed title of a tab. Used by compare tabs to
   * reflect the chosen folder pair (e.g. `left ↔ right`) once both
   * paths are filled in.
   */
  setTabTitle(id: string, title: string): void;
  /**
   * Mark a tab as having unsaved edits (or clean). Setting `false`
   * removes the `dirty` flag from the tab object so equality-based
   * tests stay simple.
   */
  setTabDirty(id: string, dirty: boolean): void;
  closeTab(id: string): void;
  /**
   * Close every tab except the always-present (first) compare tab.
   */
  closeAllFileDiffTabs(): void;
  /**
   * Close every tab except the one with the given id. The workspace
   * invariant (at least one compare tab) is preserved: if `id` is a
   * file-diff tab, the first compare tab is kept alongside it.
   * Returns the ids of the tabs that were actually closed.
   */
  closeOtherTabs(id: string): string[];
  /**
   * Close every tab and reset the workspace to a single fresh compare
   * tab (re-using the always-on `COMPARE_TAB_ID` so menu shortcuts
   * keep working). Returns the ids of the tabs that were closed.
   */
  closeAllTabs(): string[];
}

export interface CreateWorkspaceStoreOptions {
  generateId?: () => string;
  initialTabs?: WorkspaceTab[];
  initialActiveTabId?: string;
  /**
   * Hook invoked when a tab is closed. The renderer wires this to the
   * session registry so per-tab compare-session stores are released.
   */
  onTabClosed?: (tab: WorkspaceTab) => void;
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
  const onTabClosed = opts.onTabClosed;
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

    openFileDiffTab: (relPath, title, parentCompareTabId) => {
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
        parentCompareTabId,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      return id;
    },

    openCompareTab: (title) => {
      const id = generateId();
      const compareCount = get().tabs.filter((t) => t.kind === 'compare').length;
      const tab: CompareTab = {
        id,
        kind: 'compare',
        title: title ?? `Compare ${compareCount + 1}`,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      return id;
    },

    setTabTitle: (id, title) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
      })),

    setTabDirty: (id, dirty) =>
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id) return t;
          if (dirty) {
            if (t.dirty === true) return t;
            return { ...t, dirty: true };
          }
          if (t.dirty === undefined) return t;
          const { dirty: _omit, ...rest } = t;
          return rest as WorkspaceTab;
        }),
      })),

    closeTab: (id) => {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const tab = tabs[idx];
      if (!tab) return;
      // Refuse to close the last remaining compare tab — there must
      // always be at least one compare workspace.
      if (tab.kind === 'compare') {
        const compareCount = tabs.filter((t) => t.kind === 'compare').length;
        if (compareCount <= 1) return;
      }
      const next = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        // Prefer the previous tab; fall back to the first tab.
        const fallback = next[idx - 1] ?? next[idx] ?? next[0];
        nextActive = fallback?.id ?? next[0]?.id ?? COMPARE_TAB_ID;
      }
      set({ tabs: next, activeTabId: nextActive });
      onTabClosed?.(tab);
    },

    closeAllFileDiffTabs: () => {
      const closed = get().tabs.filter((t) => t.kind === 'fileDiff');
      set((s) => {
        const remainingCompare = s.tabs.filter((t) => t.kind === 'compare');
        const firstCompareId = remainingCompare[0]?.id ?? COMPARE_TAB_ID;
        return {
          tabs: remainingCompare,
          activeTabId: firstCompareId,
        };
      });
      for (const t of closed) onTabClosed?.(t);
    },

    closeOtherTabs: (id) => {
      const { tabs } = get();
      const target = tabs.find((t) => t.id === id);
      if (!target) return [];
      // Decide which tabs to keep. Always keep the target. If the
      // target isn't a compare tab, also keep the first compare tab
      // so the workspace invariant (≥1 compare tab) holds.
      const keep = new Set<string>([id]);
      if (target.kind !== 'compare') {
        const firstCompare = tabs.find((t) => t.kind === 'compare');
        if (firstCompare) keep.add(firstCompare.id);
      }
      const closed = tabs.filter((t) => !keep.has(t.id));
      if (closed.length === 0) return [];
      const next = tabs.filter((t) => keep.has(t.id));
      set({ tabs: next, activeTabId: id });
      for (const t of closed) onTabClosed?.(t);
      return closed.map((t) => t.id);
    },

    closeAllTabs: () => {
      const { tabs } = get();
      // Preserve the first compare tab (or fall back to the always-on
      // initial compare tab) so the workspace stays usable.
      const firstCompare = tabs.find((t) => t.kind === 'compare');
      const keepId = firstCompare?.id ?? COMPARE_TAB_ID;
      const closed = tabs.filter((t) => t.id !== keepId);
      if (closed.length === 0) return [];
      const kept =
        firstCompare ??
        ({ id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' } as CompareTab);
      set({ tabs: [kept], activeTabId: kept.id });
      for (const t of closed) onTabClosed?.(t);
      return closed.map((t) => t.id);
    },
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
