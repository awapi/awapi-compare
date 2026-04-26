import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Toolbar } from './Toolbar.js';
import { StatusBar } from './StatusBar.js';
import { DiffTable } from './DiffTable.js';
import { ContextMenu } from './ContextMenu.js';
import { emptyDiffSummary, summarize } from '../diffSummary.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import {
  useWorkspaceStore,
  useThemeStore,
  useRulesStore,
} from '../state/stores.js';
import { buildRowMenuItems, isActionEnabled } from '../actions.js';
import type { RowAction } from '../actions.js';
import { useHotkeys } from '../useHotkeys.js';
import type { MenuAction } from '@awapi/shared';

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

export interface CompareTabBodyProps {
  tabId: string;
  /** Whether this tab is the currently active one. Inactive tabs stay
   *  mounted (so their state and inputs persist) but ignore menu/hotkey
   *  events to avoid acting on a hidden session. */
  isActive: boolean;
  /** Open the global rules editor scoped to this session. */
  onOpenRules(): void;
  /** Open the diff-options dialog scoped to this session. */
  onOpenDiffOptions(): void;
}

function basename(p: string): string {
  const cleaned = p.replace(/[\\/]+$/u, '');
  const parts = cleaned.split(/[\\/]/u).filter(Boolean);
  return parts.length === 0 ? cleaned : (parts[parts.length - 1] ?? cleaned);
}

export function CompareTabBody({
  tabId,
  isActive,
  onOpenRules,
  onOpenDiffOptions,
}: CompareTabBodyProps): JSX.Element {
  // Per-tab session store (lazy created/cached in the registry).
  const useSession = useMemo(() => getSessionStore(tabId), [tabId]);

  const leftRoot = useSession((s) => s.leftRoot);
  const rightRoot = useSession((s) => s.rightRoot);
  const mode = useSession((s) => s.mode);
  const pairs = useSession((s) => s.pairs);
  const selected = useSession((s) => s.selectedPath);
  const scanning = useSession((s) => s.scanning);
  const progress = useSession((s) => s.progress);
  const error = useSession((s) => s.error);
  const sessionRules = useSession((s) => s.rules);
  const diffOptions = useSession((s) => s.diffOptions);
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

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const setTabTitle = useWorkspaceStore((s) => s.setTabTitle);

  const globalRules = useRulesStore((s) => s.rules);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  // Keep tab title in sync with the chosen folder pair.
  useEffect(() => {
    const left = basename(leftRoot);
    const right = basename(rightRoot);
    if (left && right) {
      setTabTitle(tabId, `${left} ↔ ${right}`);
    }
  }, [tabId, leftRoot, rightRoot, setTabTitle]);

  // Per-tab progress subscription. Each compare tab listens to scan
  // progress and, since main currently only runs one scan at a time per
  // window, we filter by `scanning` so an unrelated tab doesn't pick up
  // progress meant for its sibling.
  useEffect(() => {
    if (!scanning) return;
    const off = window.awapi?.fs.onScanProgress((p) => setProgress(p));
    return () => off?.();
  }, [scanning, setProgress]);

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
        rules: [...globalRules, ...sessionRules],
        diffOptions,
      });
      setPairs(result.pairs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [
    leftRoot,
    rightRoot,
    mode,
    globalRules,
    sessionRules,
    diffOptions,
    setScanning,
    setError,
    setProgress,
    setPairs,
  ]);

  // Auto-compare when both folder paths are set or change.
  useEffect(() => {
    if (!leftRoot.trim() || !rightRoot.trim()) return;
    if (scanning) return;
    const handle = setTimeout(() => {
      void runCompare();
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftRoot, rightRoot, mode, globalRules, sessionRules, diffOptions]);

  const summary = useMemo(
    () => (pairs.length === 0 ? emptyDiffSummary() : summarize(pairs)),
    [pairs],
  );

  const openFileDiffTab = useWorkspaceStore((s) => s.openFileDiffTab);
  const openSelected = useCallback(
    (relPath: string) => {
      const pair = pairs.find((p) => p.relPath === relPath);
      if (!pair) return;
      const looksLikeFile =
        (pair.left?.type ?? pair.right?.type ?? 'file') === 'file';
      if (!looksLikeFile) return;
      openFileDiffTab(relPath, undefined, tabId);
    },
    [pairs, openFileDiffTab, tabId],
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
          setError(`"${action}" is not implemented yet (lands in Phase 7).`);
          return;
      }
    },
    [pairs, selected, runCompare, openSelected, markSame, excludePath, setError],
  );

  // Hotkeys + app-menu actions only fire on the active tab.
  useHotkeys({
    onAction: (action) => {
      if (!isActive) return;
      void dispatchAction(action);
    },
  });

  useEffect(() => {
    if (!isActive) return;
    const off = window.awapi?.app.onMenuAction((menuAction) => {
      if (menuAction === 'session.refresh') {
        void runCompare();
        return;
      }
      if (menuAction === 'view.toggleTheme') {
        toggleTheme();
        return;
      }
      const rowAction = MENU_TO_ROW[menuAction];
      if (rowAction) void dispatchAction(rowAction);
    });
    return () => off?.();
  }, [isActive, runCompare, toggleTheme, dispatchAction]);

  const handleContextMenu = useCallback((relPath: string, x: number, y: number) => {
    setMenu({ relPath, x, y });
  }, []);

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const menuItems = useMemo(() => {
    if (!menu) return [];
    const pair = pairs.find((p) => p.relPath === menu.relPath);
    return buildRowMenuItems({ pair });
  }, [menu, pairs]);

  return (
    <div className="awapi-compare-body">
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
        onOpenRules={onOpenRules}
        onOpenDiffOptions={onOpenDiffOptions}
        onPickLeftFolder={async () => {
          if (!window.awapi?.dialog) return;
          const picked = await window.awapi.dialog.pickFolder({
            defaultPath: leftRoot || undefined,
            title: 'Select left folder',
          });
          if (picked) setLeftRoot(picked);
        }}
        onPickRightFolder={async () => {
          if (!window.awapi?.dialog) return;
          const picked = await window.awapi.dialog.pickFolder({
            defaultPath: rightRoot || undefined,
            title: 'Select right folder',
          });
          if (picked) setRightRoot(picked);
        }}
      />
      <DiffTable
        pairs={pairs}
        selectedPath={selected}
        theme={theme}
        onSelect={setSelectedPath}
        onActivate={openSelected}
        onContextMenu={handleContextMenu}
      />
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
        <div role="alert" className="awapi-compare-body__error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
