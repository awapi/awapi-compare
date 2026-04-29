import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Toolbar } from './Toolbar.js';
import { StatusBar } from './StatusBar.js';
import { DiffTable } from './DiffTable.js';
import { ContextMenu } from './ContextMenu.js';
import { OverwriteConfirmDialog } from './OverwriteConfirmDialog.js';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.js';
import { RenameDialog } from './RenameDialog.js';
import { emptyDiffSummary, summarize } from '../diffSummary.js';
import { getSessionStore } from '../state/sessionRegistry.js';
import { useSessionPersistence } from '../state/useSessionPersistence.js';
import {
  useWorkspaceStore,
  useThemeStore,
  useRulesStore,
  usePreferencesStore,
  useRecentsStore,
} from '../state/stores.js';
import { buildRowMenuItems, isActionEnabled } from '../actions.js';
import type { RowAction } from '../actions.js';
import { useHotkeys } from '../useHotkeys.js';
import { filterPairs } from '../viewFilter.js';
import { joinPath } from '../paths.js';
import { parentDir } from '../pathUtils.js';
import { useDropPaths } from '../useDropPaths.js';
import type { DropSide } from '../useDropPaths.js';
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
  side: 'left' | 'right';
}

interface OverwritePromptState {
  direction: 'leftToRight' | 'rightToLeft';
  from: string;
  to: string;
  target: string;
  detail: string;
}

interface DeletePromptState {
  pair: ComparedPair;
  primaryPath: string;
  otherPath?: string;
  otherSide?: 'left' | 'right';
  target: string;
  isDirectory: boolean;
}

interface RenamePromptState {
  pair: ComparedPair;
  originalName: string;
  primarySide: 'left' | 'right';
  otherSide?: 'left' | 'right';
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

  // Auto-save session config to disk on change.
  useSessionPersistence(tabId);

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

  // Recent folder paths (15 newest per side), surfaced in the
  // toolbar's path inputs as a native combobox.
  const recents = useRecentsStore((s) => s.recents);
  const addRecent = useRecentsStore((s) => s.add);
  const leftRecents = recents['folder:left'];
  const rightRecents = recents['folder:right'];

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [overwritePrompt, setOverwritePrompt] =
    useState<OverwritePromptState | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePromptState | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<RenamePromptState | null>(null);

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
    // Allow listing a single side while the other is still being
    // picked. We only require *at least one* root to be set.
    if (!left && !right) return;
    setScanning(true);
    setError(null);
    setProgress(null);
    try {
      // Validate the roots that were provided. A blank side simply
      // means "not selected yet" and is skipped here (and in main).
      const sides: Array<{ side: 'Left' | 'Right'; path: string }> = [];
      if (left) sides.push({ side: 'Left', path: left });
      if (right) sides.push({ side: 'Right', path: right });
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
      // Remember the folder pair only after a successful scan, so a
      // typo'd path that errored out above doesn't pollute the
      // dropdown. Only record sides that were actually scanned.
      if (left) addRecent('folder', 'left', left);
      if (right) addRecent('folder', 'right', right);
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
    addRecent,
  ]);

  // Auto-compare when at least one folder path is set. With only one
  // side, the scan lists that side's contents (entries appear as
  // left-only / right-only). Once both sides are set, the next run
  // produces the full colored comparison.
  useEffect(() => {
    if (!leftRoot.trim() && !rightRoot.trim()) return;
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

  const errorEntries = useMemo(
    () =>
      pairs
        .filter((p) => p.status === 'error')
        .map((p) => ({ relPath: p.relPath, message: p.error ?? '' })),
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

  const requestDelete = useCallback(
    (pair: ComparedPair, side?: 'left' | 'right') => {
      // Resolve the primary side: clicked side if it has an entry,
      // otherwise fall back to whichever side has an entry.
      let primarySide: 'left' | 'right' | null = null;
      if (side) {
        primarySide = (side === 'left' ? !!pair.left : !!pair.right) ? side
          : pair.left ? 'left'
          : pair.right ? 'right'
          : null;
      } else {
        primarySide = pair.left ? 'left' : pair.right ? 'right' : null;
      }
      if (!primarySide) {
        setError('Nothing to delete: both sides are empty.');
        return;
      }
      const otherSide: 'left' | 'right' = primarySide === 'left' ? 'right' : 'left';
      const primaryEntry = primarySide === 'left' ? pair.left : pair.right;
      const otherEntry = otherSide === 'left' ? pair.left : pair.right;
      const primaryRoot = primarySide === 'left' ? leftRoot : rightRoot;
      const otherRoot = otherSide === 'left' ? leftRoot : rightRoot;
      if (!primaryEntry || !primaryRoot) {
        setError('Nothing to delete: both sides are empty.');
        return;
      }
      const primaryPath = joinPath(primaryRoot, primaryEntry.relPath);
      const otherPath =
        otherEntry && otherRoot ? joinPath(otherRoot, otherEntry.relPath) : undefined;
      const isDirectory = (primaryEntry.type ?? 'file') === 'dir';
      const target = primaryEntry.name ?? pair.relPath;
      setDeletePrompt({ pair, primaryPath, otherPath, otherSide: otherPath ? otherSide : undefined, target, isDirectory });
    },
    [leftRoot, rightRoot, setError],
  );

  const performDelete = useCallback(
    async (paths: string[]) => {
      if (!window.awapi) return;
      try {
        const result = await window.awapi.fs.rm({ paths });
        if (result.errors.length > 0) {
          const first = result.errors[0];
          setError(
            `Delete completed with ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}: ${first?.message ?? 'unknown error'}`,
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

  const requestRename = useCallback(
    (pair: ComparedPair, side?: 'left' | 'right') => {
      // Resolve primary side the same way as requestDelete.
      let primarySide: 'left' | 'right' | null = null;
      if (side) {
        primarySide = (side === 'left' ? !!pair.left : !!pair.right) ? side
          : pair.left ? 'left'
          : pair.right ? 'right'
          : null;
      } else {
        primarySide = pair.left ? 'left' : pair.right ? 'right' : null;
      }
      if (!primarySide) return;
      const refEntry = primarySide === 'left' ? pair.left : pair.right;
      if (!refEntry) return;
      const otherSide: 'left' | 'right' = primarySide === 'left' ? 'right' : 'left';
      const otherEntry = otherSide === 'left' ? pair.left : pair.right;
      const originalName = refEntry.name || basename(refEntry.relPath);
      setRenamePrompt({
        pair,
        originalName,
        primarySide,
        otherSide: otherEntry ? otherSide : undefined,
      });
    },
    [],
  );

  const performRename = useCallback(
    async (pair: ComparedPair, newName: string, sides: Array<'left' | 'right'>) => {
      if (!window.awapi) return;
      const renames: Array<{ from: string; to: string }> = [];
      for (const side of sides) {
        const entry = side === 'left' ? pair.left : pair.right;
        const root = side === 'left' ? leftRoot : rightRoot;
        if (!entry || !root) continue;
        const from = joinPath(root, entry.relPath);
        const parent = parentDir(from);
        if (parent) renames.push({ from, to: joinPath(parent, newName) });
      }
      if (renames.length === 0) {
        setError('Nothing to rename.');
        return;
      }
      const failures: string[] = [];
      for (const r of renames) {
        try {
          await window.awapi.fs.rename(r);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (failures.length > 0) {
        setError(
          `Rename failed: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`,
        );
      } else {
        setError(null);
      }
      await runCompare();
    },
    [leftRoot, rightRoot, runCompare, setError],
  );

  const dispatchAction = useCallback(
    async (action: RowAction, relPath?: string, side?: 'left' | 'right') => {
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
        case 'rename':
          if (pair) requestRename(pair, side);
          return;
        case 'delete':
          if (pair) requestDelete(pair, side);
          return;
      }
    },
    [pairs, selected, runCompare, openSelected, markSame, excludePath, setError, setLeftRoot, setRightRoot, leftRoot, rightRoot, requestCopy, requestDelete, requestRename],
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

  const handleContextMenu = useCallback(
    (relPath: string, side: 'left' | 'right', x: number, y: number) => {
      setMenu({ relPath, side, x, y });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setMenu(null), []);

  // Drag-and-drop:
  //   • Folder dropped → set that side's root and re-run the compare.
  //   • File dropped → open a new file-diff tab seeded with that path
  //     on the dropped side. If two files were dropped at once, both
  //     sides are seeded regardless of pointer position.
  //   • Mixed (folder + file) → folder wins; treated as a folder drop.
  const handleDropPaths = useCallback(
    async (side: DropSide, paths: string[]) => {
      if (!window.awapi?.fs?.stat || paths.length === 0) return;
      const stats = await Promise.all(
        paths.map(async (p) => {
          try {
            const s = await window.awapi.fs.stat({ path: p });
            return { path: p, type: s.type };
          } catch {
            return { path: p, type: 'other' as const };
          }
        }),
      );
      const folder = stats.find((s) => s.type === 'dir');
      if (folder) {
        if (side === 'left') setLeftRoot(folder.path);
        else setRightRoot(folder.path);
        addRecent('folder', side, folder.path);
        return;
      }
      const files = stats.filter((s) => s.type === 'file').map((s) => s.path);
      if (files.length === 0) return;
      let leftFile: string | undefined;
      let rightFile: string | undefined;
      if (files.length >= 2) {
        leftFile = files[0];
        rightFile = files[1];
      } else if (side === 'left') {
        leftFile = files[0];
      } else {
        rightFile = files[0];
      }
      if (leftFile) addRecent('file', 'left', leftFile);
      if (rightFile) addRecent('file', 'right', rightFile);
      const titleParts = [leftFile, rightFile].filter((p): p is string => Boolean(p));
      const title = titleParts
        .map((p) => p.split(/[\\/]/u).filter(Boolean).pop() ?? p)
        .join(' ↔ ');
      const relPath = `dropped:${leftFile ?? ''}|${rightFile ?? ''}`;
      openFileDiffTab(relPath, title || 'File diff', undefined, {
        left: leftFile,
        right: rightFile,
      });
    },
    [setLeftRoot, setRightRoot, addRecent, openFileDiffTab],
  );
  const { dropProps, hoverSide } = useDropPaths({ onDrop: handleDropPaths });

  const menuItems = useMemo(() => {
    if (!menu) return [];
    const pair = pairs.find((p) => p.relPath === menu.relPath);
    return buildRowMenuItems({ pair });
  }, [menu, pairs]);

  return (
    <div
      className={`awapi-compare-body${hoverSide ? ` awapi-compare-body--drop-${hoverSide}` : ''}`}
      {...dropProps}
    >
      <Toolbar
        leftRoot={leftRoot}
        rightRoot={rightRoot}
        mode={mode}
        scanning={scanning}
        theme={theme}
        viewFilter={viewFilter}
        leftRecents={leftRecents}
        rightRecents={rightRecents}
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
          if (picked) {
            setLeftRoot(picked);
            addRecent('folder', 'left', picked);
          }
        }}
        onPickRightFolder={async () => {
          if (!window.awapi?.dialog) return;
          const picked = await window.awapi.dialog.pickFolder({
            defaultPath: rightRoot || undefined,
            title: 'Select right folder',
          });
          if (picked) {
            setRightRoot(picked);
            addRecent('folder', 'right', picked);
          }
        }}
        onGoUpLeft={() => {
          const parent = parentDir(leftRoot);
          if (parent !== null) setLeftRoot(parent);
        }}
        onGoUpRight={() => {
          const parent = parentDir(rightRoot);
          if (parent !== null) setRightRoot(parent);
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
      <StatusBar
        summary={summary}
        progress={progress}
        scanning={scanning}
        theme={theme}
        errors={errorEntries}
      />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={(action) => {
            const target = menu.relPath;
            const side = menu.side;
            closeContextMenu();
            void dispatchAction(action, target, side);
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
      {deletePrompt ? (
        <DeleteConfirmDialog
          target={deletePrompt.target}
          primaryPath={deletePrompt.primaryPath}
          otherPath={deletePrompt.otherPath}
          otherSide={deletePrompt.otherSide}
          isDirectory={deletePrompt.isDirectory}
          onCancel={() => setDeletePrompt(null)}
          onConfirm={(applyToOther) => {
            const prompt = deletePrompt;
            setDeletePrompt(null);
            const paths = [prompt.primaryPath];
            if (applyToOther && prompt.otherPath) paths.push(prompt.otherPath);
            void performDelete(paths);
          }}
        />
      ) : null}
      {renamePrompt ? (
        <RenameDialog
          originalName={renamePrompt.originalName}
          otherSide={renamePrompt.otherSide}
          onCancel={() => setRenamePrompt(null)}
          onConfirm={(newName, applyToOther) => {
            const prompt = renamePrompt;
            setRenamePrompt(null);
            const sides: Array<'left' | 'right'> = [prompt.primarySide];
            if (applyToOther && prompt.otherSide) sides.push(prompt.otherSide);
            void performRename(prompt.pair, newName, sides);
          }}
        />
      ) : null}
    </div>
  );
}
