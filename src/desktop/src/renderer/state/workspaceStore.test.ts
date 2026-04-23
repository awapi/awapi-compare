import { describe, expect, it } from 'vitest';
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

  it('refuses to close the compare tab', () => {
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

  it('closeAllFileDiffTabs leaves only the compare tab', () => {
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
});
