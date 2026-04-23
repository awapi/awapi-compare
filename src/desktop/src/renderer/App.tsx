import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Toolbar } from './components/Toolbar.js';
import { StatusBar } from './components/StatusBar.js';
import { DiffTable } from './components/DiffTable.js';
import { Tabs } from './components/Tabs.js';
import { FileDiffTab } from './components/FileDiffTab.js';
import { ContextMenu } from './components/ContextMenu.js';
import { emptyDiffSummary, summarize } from './diffSummary.js';
import { createSessionStore } from './state/sessionStore.js';
import { createThemeStore } from './state/themeStore.js';
import { createWorkspaceStore, COMPARE_TAB_ID } from './state/workspaceStore.js';
import { buildRowMenuItems, isActionEnabled } from './actions.js';
import type { RowAction } from './actions.js';
import { useHotkeys } from './useHotkeys.js';
import type { MenuAction } from '@awapi/shared';

const useSession = createSessionStore();
const useTheme = createThemeStore();
const useWorkspace = createWorkspaceStore();

const MENU_TO_ROW: Partial<Record<MenuAction, RowAction>> = {
  'compare.copyLeftToRight': 'copyLeftToRight',
  'compare.copyRightToLeft': 'copyRightToLeft',
  'compare.markSame': 'markSame',
  'compare.exclude': 'exclude',
};

interface ContextMenuState {
  x: number;
  y: number;
  relPath: string;
}

export function App(): JSX.Element {
  const leftRoot = useSession((s) => s.leftRoot);
  const rightRoot = useSession((s) => s.rightRoot);
  const mode = useSession((s) => s.mode);
  const pairs = useSession((s) => s.pairs);
  const selected = useSession((s) => s.selectedPath);
  const scanning = useSession((s) => s.scanning);
  const progress = useSession((s) => s.progress);
  const error = useSession((s) => s.error);
  const setLeftRoot = useSession((s) => s.setLeftRoot);
  const setRightRoot = useSession((s) => s.setRightRoot);
  const setMode = useSession((s) => s.setMode);
  const setPairs = useSession((s) => s.setPairs);
  const setScanning = useSession((s) => s.setScanning);
  const setProgress = useSession((s) => s.setProgress);
  const setSelectedPath = useSession((s) => s.setSelectedPath);
  const setError = useSession((s) => s.setError);
  const markSame = useSession((s) => s.markSame);
  const excludePath = useSession((s) => s.excludePath);

  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);

  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const setActiveTab = useWorkspace((s) => s.setActiveTab);
  const openFileDiffTab = useWorkspace((s) => s.openFileDiffTab);
  const closeTab = useWorkspace((s) => s.closeTab);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    const off = window.awapi?.fs.onScanProgress((p) => setProgress(p));
    return () => off?.();
  }, [setProgress]);

  const runCompare = useCallback(async () => {
    if (!window.awapi) return;
    setScanning(true);
    setError(null);
    setProgress(null);
    try {
      const result = await window.awapi.fs.scan({
        leftRoot,
        rightRoot,
        mode,
        rules: [],
      });
      setPairs(result.pairs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [leftRoot, rightRoot, mode, setScanning, setError, setProgress, setPairs]);

  const summary = useMemo(
    () => (pairs.length === 0 ? emptyDiffSummary() : summarize(pairs)),
    [pairs],
  );

  const openSelected = useCallback(
    (relPath: string) => {
      const pair = pairs.find((p) => p.relPath === relPath);
      if (!pair) return;
      // Only open file-diff tabs for file pairs.
      const looksLikeFile =
        (pair.left?.type ?? pair.right?.type ?? 'file') === 'file';
      if (!looksLikeFile) return;
      openFileDiffTab(relPath);
    },
    [pairs, openFileDiffTab],
  );

  const dispatchAction = useCallback(
    async (action: RowAction, relPath?: string) => {
      const targetPath = relPath ?? selected ?? null;
      const pair = targetPath ? pairs.find((p) => p.relPath === targetPath) : undefined;
      if (!isActionEnabled(action, { pair })) return;
      switch (action) {
        case 'compare':
          await runCompare();
          return;
        case 'open':
          if (targetPath) openSelected(targetPath);
          return;
        case 'markSame':
          if (targetPath) markSame(targetPath);
          return;
        case 'exclude':
          if (targetPath) excludePath(targetPath);
          return;
        case 'copyLeftToRight':
        case 'copyRightToLeft':
        case 'delete':
          // The underlying IPC handlers throw `NotImplementedError` until
          // Phase 7. Surface a friendly message instead of a stack trace.
          setError(`"${action}" is not implemented yet (lands in Phase 7).`);
          return;
      }
    },
    [pairs, selected, runCompare, openSelected, markSame, excludePath, setError],
  );

  useHotkeys({
    onAction: (action) => {
      void dispatchAction(action);
    },
  });

  // App-menu actions from main process. Map the subset that overlaps with
  // row actions; the rest (session.*, view.*, help.*) are wired in later
  // phases.
  useEffect(() => {
    const off = window.awapi?.app.onMenuAction((menuAction) => {
      if (menuAction === 'session.refresh') {
        void runCompare();
        return;
      }
      if (menuAction === 'view.toggleTheme') {
        toggleTheme();
        return;
      }
      if (menuAction === 'session.closeTab') {
        if (activeTabId !== COMPARE_TAB_ID) closeTab(activeTabId);
        return;
      }
      const rowAction = MENU_TO_ROW[menuAction];
      if (rowAction) void dispatchAction(rowAction);
    });
    return () => off?.();
  }, [runCompare, toggleTheme, activeTabId, closeTab, dispatchAction]);

  const handleContextMenu = useCallback((relPath: string, x: number, y: number) => {
    setMenu({ relPath, x, y });
  }, []);

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const menuItems = useMemo(() => {
    if (!menu) return [];
    const pair = pairs.find((p) => p.relPath === menu.relPath);
    return buildRowMenuItems({ pair });
  }, [menu, pairs]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="awapi-app">
      <Toolbar
        leftRoot={leftRoot}
        rightRoot={rightRoot}
        mode={mode}
        scanning={scanning}
        theme={theme}
        onLeftRootChange={setLeftRoot}
        onRightRootChange={setRightRoot}
        onModeChange={setMode}
        onCompare={runCompare}
        onRefresh={runCompare}
        onToggleTheme={toggleTheme}
      />
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={closeTab}
      />
      {activeTab?.kind === 'fileDiff' ? (
        <FileDiffTab
          relPath={activeTab.relPath}
          pair={pairs.find((p) => p.relPath === activeTab.relPath)}
        />
      ) : (
        <DiffTable
          pairs={pairs}
          selectedPath={selected}
          theme={theme}
          onSelect={setSelectedPath}
          onActivate={openSelected}
          onContextMenu={handleContextMenu}
        />
      )}
      <StatusBar summary={summary} progress={progress} scanning={scanning} theme={theme} />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={(action) => {
            const target = menu.relPath;
            closeContextMenu();
            void dispatchAction(action, target);
          }}
          onClose={closeContextMenu}
        />
      ) : null}
      {error ? (
        <div role="alert" style={{ padding: 8, background: '#5a1f1f', color: '#fff' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
