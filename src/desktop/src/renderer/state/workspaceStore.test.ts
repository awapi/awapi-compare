import { describe, expect, it, vi } from 'vitest';
import { COMPARE_TAB_ID, createWorkspaceStore } from './workspaceStore.js';

let nextId = 0;
const generateId = (): string => `t${++nextId}`;

describe('workspaceStore', () => {
  it('starts with the always-on Compare tab active', () => {
    const useStore = createWorkspaceStore({ generateId });
    const s = useStore.getState();
    expect(s.tabs).toEqual([{ id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' }]);
    expect(s.activeTabId).toBe(COMPARE_TAB_ID);
  });

  it('opens a new file-diff tab and focuses it', () => {
    const useStore = createWorkspaceStore({ generateId: () => 'file-1' });
    const id = useStore.getState().openFileDiffTab('a/b/foo.txt');
    expect(id).toBe('file-1');
    const s = useStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]).toMatchObject({
      id: 'file-1',
      kind: 'fileDiff',
      relPath: 'a/b/foo.txt',
      title: 'foo.txt',
    });
    expect(s.activeTabId).toBe('file-1');
  });

  it('de-duplicates file-diff tabs by relPath and re-focuses the existing tab', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    const a = useStore.getState().openFileDiffTab('foo.txt');
    useStore.getState().setActiveTab(COMPARE_TAB_ID);
    const b = useStore.getState().openFileDiffTab('foo.txt');
    expect(a).toBe(b);
    expect(useStore.getState().tabs).toHaveLength(2);
    expect(useStore.getState().activeTabId).toBe(a);
  });

  it('honours an explicit title override', () => {
    const useStore = createWorkspaceStore({ generateId: () => 'x' });
    useStore.getState().openFileDiffTab('a/b/c.ts', 'Custom');
    expect(useStore.getState().tabs[1]?.title).toBe('Custom');
  });

  it('refuses to close the last remaining compare tab', () => {
    const useStore = createWorkspaceStore({ generateId });
    useStore.getState().closeTab(COMPARE_TAB_ID);
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it('closes a file-diff tab and falls back to the previous tab', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    const id1 = useStore.getState().openFileDiffTab('a.txt');
    const id2 = useStore.getState().openFileDiffTab('b.txt');
    expect(useStore.getState().activeTabId).toBe(id2);
    useStore.getState().closeTab(id2);
    expect(useStore.getState().tabs.map((t) => t.id)).toEqual([COMPARE_TAB_ID, id1]);
    expect(useStore.getState().activeTabId).toBe(id1);
  });

  it('closing a non-active tab keeps the active tab', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    const id1 = useStore.getState().openFileDiffTab('a.txt');
    const id2 = useStore.getState().openFileDiffTab('b.txt');
    useStore.getState().setActiveTab(id2);
    useStore.getState().closeTab(id1);
    expect(useStore.getState().activeTabId).toBe(id2);
  });

  it('closeAllFileDiffTabs leaves only the compare tab(s)', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    useStore.getState().openFileDiffTab('a');
    useStore.getState().openFileDiffTab('b');
    useStore.getState().closeAllFileDiffTabs();
    expect(useStore.getState().tabs).toEqual([
      { id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' },
    ]);
    expect(useStore.getState().activeTabId).toBe(COMPARE_TAB_ID);
  });

  it('setActiveTab ignores unknown ids', () => {
    const useStore = createWorkspaceStore({ generateId });
    useStore.getState().setActiveTab('nope');
    expect(useStore.getState().activeTabId).toBe(COMPARE_TAB_ID);
  });

  it('openCompareTab adds a new compare tab and focuses it', () => {
    const useStore = createWorkspaceStore({ generateId: () => 'c2' });
    const id = useStore.getState().openCompareTab();
    const s = useStore.getState();
    expect(id).toBe('c2');
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]).toMatchObject({ id: 'c2', kind: 'compare', title: 'Compare 2' });
    expect(s.activeTabId).toBe('c2');
  });

  it('allows closing a compare tab once more than one exists', () => {
    const useStore = createWorkspaceStore({ generateId: () => 'c2' });
    const id = useStore.getState().openCompareTab();
    useStore.getState().closeTab(id);
    expect(useStore.getState().tabs).toEqual([
      { id: COMPARE_TAB_ID, kind: 'compare', title: 'Compare' },
    ]);
    expect(useStore.getState().activeTabId).toBe(COMPARE_TAB_ID);
  });

  it('setTabTitle renames a tab', () => {
    const useStore = createWorkspaceStore({ generateId });
    useStore.getState().setTabTitle(COMPARE_TAB_ID, 'left ↔ right');
    expect(useStore.getState().tabs[0]?.title).toBe('left ↔ right');
  });

  it('invokes onTabClosed when a tab is closed', () => {
    const onTabClosed = vi.fn();
    const useStore = createWorkspaceStore({
      generateId: () => 'c2',
      onTabClosed,
    });
    const id = useStore.getState().openCompareTab();
    useStore.getState().closeTab(id);
    expect(onTabClosed).toHaveBeenCalledWith(
      expect.objectContaining({ id, kind: 'compare' }),
    );
  });

  it('does not invoke onTabClosed when refusing to close the last compare', () => {
    const onTabClosed = vi.fn();
    const useStore = createWorkspaceStore({ generateId, onTabClosed });
    useStore.getState().closeTab(COMPARE_TAB_ID);
    expect(onTabClosed).not.toHaveBeenCalled();
  });

  it('closeOtherTabs keeps only the target tab when target is compare', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    const compare2 = useStore.getState().openCompareTab();
    useStore.getState().openFileDiffTab('a.txt');
    useStore.getState().openFileDiffTab('b.txt');
    const closed = useStore.getState().closeOtherTabs(compare2);
    expect(closed).toHaveLength(3);
    expect(useStore.getState().tabs.map((t) => t.id)).toEqual([compare2]);
    expect(useStore.getState().activeTabId).toBe(compare2);
  });

  it('closeOtherTabs preserves the first compare tab when target is a file-diff', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    const a = useStore.getState().openFileDiffTab('a.txt');
    useStore.getState().openFileDiffTab('b.txt');
    const closed = useStore.getState().closeOtherTabs(a);
    // Only b.txt is closed; the first compare tab is preserved.
    expect(closed).toHaveLength(1);
    expect(useStore.getState().tabs.map((t) => t.id)).toEqual([COMPARE_TAB_ID, a]);
    expect(useStore.getState().activeTabId).toBe(a);
  });

  it('closeOtherTabs is a no-op when only the target exists', () => {
    const useStore = createWorkspaceStore({ generateId });
    const closed = useStore.getState().closeOtherTabs(COMPARE_TAB_ID);
    expect(closed).toEqual([]);
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it('closeOtherTabs notifies onTabClosed for each closed tab', () => {
    const onTabClosed = vi.fn();
    let n = 0;
    const useStore = createWorkspaceStore({
      generateId: () => `g${++n}`,
      onTabClosed,
    });
    const a = useStore.getState().openFileDiffTab('a.txt');
    useStore.getState().openFileDiffTab('b.txt');
    useStore.getState().closeOtherTabs(a);
    expect(onTabClosed).toHaveBeenCalledTimes(1);
    expect(onTabClosed).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: 'b.txt' }),
    );
  });

  it('closeAllTabs leaves a single compare tab and focuses it', () => {
    let n = 0;
    const useStore = createWorkspaceStore({ generateId: () => `g${++n}` });
    useStore.getState().openCompareTab();
    useStore.getState().openFileDiffTab('a.txt');
    useStore.getState().openFileDiffTab('b.txt');
    const closed = useStore.getState().closeAllTabs();
    expect(closed).toHaveLength(3);
    const s = useStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ id: COMPARE_TAB_ID, kind: 'compare' });
    expect(s.activeTabId).toBe(COMPARE_TAB_ID);
  });

  it('closeAllTabs is a no-op on a fresh workspace', () => {
    const useStore = createWorkspaceStore({ generateId });
    const closed = useStore.getState().closeAllTabs();
    expect(closed).toEqual([]);
    expect(useStore.getState().tabs).toHaveLength(1);
  });
});
