import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Toolbar } from './Toolbar.js';
import { StatusBar } from './StatusBar.js';
import { DiffTable } from './DiffTable.js';
import { ContextMenu } from './ContextMenu.js';
import { OverwriteConfirmDialog } from './OverwriteConfirmDialog.js';
import { emptyDiffSummary, summarize } from '../diffSummary.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import {
  useWorkspaceStore,
  useThemeStore,
  useRulesStore,
  usePreferencesStore,
} from '../state/stores.js';
import { buildRowMenuItems, isActionEnabled } from '../actions.js';
import type { RowAction } from '../actions.js';
import { useHotkeys } from '../useHotkeys.js';
import { filterPairs } from '../viewFilter.js';
import { joinPath } from '../paths.js';
import type { ComparedPair, MenuAction } from '@awapi/shared';

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

interface OverwritePromptState {
  direction: 'leftToRight' | 'rightToLeft';
  from: string;
  to: string;
  target: string;
  detail: string;
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
  const viewFilter = useSession((s) => s.viewFilter);
  const setLeftRoot = useSession((s) => s.setLeftRoot);
  const setRightRoot = useSession((s) => s.setRightRoot);
  const setMode = useSession((s) => s.setMode);
  const setPairs = useSession((s) => s.setPairs);
  const setScanning = useSession((s) => s.setScanning);
  const setProgress = useSession((s) => s.setProgress);
  const setSelectedPath = useSession((s) => s.setSelectedPath);
  const setError = useSession((s) => s.setError);
  const setViewFilter = useSession((s) => s.setViewFilter);
  const markSame = useSession((s) => s.markSame);
  const excludePath = useSession((s) => s.excludePath);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const setTabTitle = useWorkspaceStore((s) => s.setTabTitle);

  const globalRules = useRulesStore((s) => s.rules);

  const confirmOverwriteOnCopy = usePreferencesStore((s) => s.confirmOverwriteOnCopy);
  const setConfirmOverwriteOnCopy = usePreferencesStore(
    (s) => s.setConfirmOverwriteOnCopy,
  );

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [overwritePrompt, setOverwritePrompt] =
    useState<OverwritePromptState | null>(null);

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
    const left = leftRoot.trim();
    const right = rightRoot.trim();
    if (!left || !right) return;
    setScanning(true);
    setError(null);
    setProgress(null);
    try {
      // Validate both roots exist and are directories before kicking
      // off a scan. Without this, a missing/typo'd path silently
      // produces an empty result, which is confusing for the user.
      const sides: Array<{ side: 'Left' | 'Right'; path: string }> = [
        { side: 'Left', path: left },
        { side: 'Right', path: right },
      ];
      for (const { side, path } of sides) {
        try {
          const st = await window.awapi.fs.stat({ path });
          if (st.type !== 'dir') {
            setPairs([]);
            setError(`${side} folder is not a directory: ${path}`);
            return;
          }
        } catch {
          setPairs([]);
          setError(`${side} folder does not exist: ${path}`);
          return;
        }
      }
      const result = await window.awapi.fs.scan({
        leftRoot: left,
        rightRoot: right,
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
  }, [leftRoot, rightRoot, mode, globalRules, sessionRules, diffOptions]);

  const summary = useMemo(
    () => (pairs.length === 0 ? emptyDiffSummary() : summarize(pairs)),
    [pairs],
  );

  // Apply the All/Diffs/Same filter on top of the raw scan result. The
  // summary continues to reflect the unfiltered totals so the status
  // bar stays meaningful regardless of the active view.
  const visiblePairs = useMemo(
    () => filterPairs(pairs, viewFilter),
    [pairs, viewFilter],
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

  const performCopy = useCallback(
    async (from: string, to: string, overwrite: boolean) => {
      if (!window.awapi) return;
      try {
        const result = await window.awapi.fs.copy({ from, to, overwrite });
        if (result.errors.length > 0) {
          const first = result.errors[0];
          setError(
            `Copy completed with ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}: ${first?.message ?? 'unknown error'}`,
          );
        } else {
          setError(null);
        }
        await runCompare();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runCompare, setError],
  );

  const requestCopy = useCallback(
    (
      direction: 'leftToRight' | 'rightToLeft',
      pair: ComparedPair,
    ) => {
      const sourceEntry = direction === 'leftToRight' ? pair.left : pair.right;
      if (!sourceEntry) return;
      const sourceRoot = direction === 'leftToRight' ? leftRoot : rightRoot;
      const destRoot = direction === 'leftToRight' ? rightRoot : leftRoot;
      if (!sourceRoot || !destRoot) {
        setError('Both folder roots must be set before copying.');
        return;
      }
      const from = joinPath(sourceRoot, sourceEntry.relPath);
      const to = joinPath(destRoot, sourceEntry.relPath);
      const destinationEntry =
        direction === 'leftToRight' ? pair.right : pair.left;
      const willOverwrite = !!destinationEntry;

      if (willOverwrite && confirmOverwriteOnCopy) {
        setOverwritePrompt({
          direction,
          from,
          to,
          target: sourceEntry.name || sourceEntry.relPath,
          detail: to,
        });
        return;
      }
      void performCopy(from, to, willOverwrite);
    },
    [leftRoot, rightRoot, confirmOverwriteOnCopy, performCopy, setError],
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
        case 'useAsLeftFolderOnly':
          if (pair?.left?.type === 'dir') {
            setLeftRoot(joinPath(leftRoot, pair.left.relPath));
          }
          return;
        case 'useAsRightFolderOnly':
          if (pair?.right?.type === 'dir') {
            setRightRoot(joinPath(rightRoot, pair.right.relPath));
          }
          return;
        case 'openSelectedFolders':
          if (pair) {
            const rel = pair.left?.relPath ?? pair.right?.relPath ?? pair.relPath;
            if (rel) {
              setLeftRoot(joinPath(leftRoot, rel));
              setRightRoot(joinPath(rightRoot, rel));
            }
          }
          return;
        case 'copyLeftToRight':
          if (pair) requestCopy('leftToRight', pair);
          return;
        case 'copyRightToLeft':
          if (pair) requestCopy('rightToLeft', pair);
          return;
        case 'delete':
          setError(`"${action}" is not implemented yet.`);
          return;
      }
    },
    [pairs, selected, runCompare, openSelected, markSame, excludePath, setError, setLeftRoot, setRightRoot, leftRoot, rightRoot, requestCopy],
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
        viewFilter={viewFilter}
        onViewFilterChange={setViewFilter}
        onLeftRootChange={setLeftRoot}
        onRightRootChange={setRightRoot}
        onModeChange={setMode}
        onRefresh={runCompare}
        onSubmitPaths={runCompare}
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
        pairs={visiblePairs}
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
      {overwritePrompt ? (
        <OverwriteConfirmDialog
          direction={overwritePrompt.direction}
          target={overwritePrompt.target}
          detail={overwritePrompt.detail}
          onCancel={() => setOverwritePrompt(null)}
          onConfirm={(remember) => {
            const prompt = overwritePrompt;
            setOverwritePrompt(null);
            if (remember) setConfirmOverwriteOnCopy(false);
            void performCopy(prompt.from, prompt.to, true);
          }}
        />
      ) : null}
    </div>
  );
}
