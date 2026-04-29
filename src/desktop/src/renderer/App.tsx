import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AboutDialog } from './components/AboutDialog.js';
import { CompareTabBody } from './components/CompareTabBody.js';
import { DiffOptionsDialog } from './components/DiffOptionsDialog.js';
import { FileDiffTab } from './components/FileDiffTab.js';
import { PreferencesDialog } from './components/PreferencesDialog.js';
import { Tabs } from './components/Tabs.js';
import { RulesEditor, type RulesScope } from './components/RulesEditor.js';
import { UpdateCheckDialog } from './components/UpdateCheckDialog.js';
import {
  usePreferencesStore,
  useRulesStore,
  useThemeStore,
  useWorkspaceStore,
} from './state/stores.js';
import { getSessionStore } from './state/sessionRegistry.js';
import { getTabSaveHandler } from './state/tabSaveRegistry.js';
import { DEFAULT_DIFF_OPTIONS, type DiffOptions, type Rule } from '@awapi/shared';

export function App(): JSX.Element {
  const theme = useThemeStore((s) => s.theme);

  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openCompareTab = useWorkspaceStore((s) => s.openCompareTab);

  const globalRules = useRulesStore((s) => s.rules);
  const setGlobalRules = useRulesStore((s) => s.setRules);
  const rulesLoaded = useRulesStore((s) => s.loaded);
  const markRulesLoaded = useRulesStore((s) => s.markLoaded);

  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
  const [rulesScope, setRulesScope] = useState<RulesScope>('global');
  const [diffOptionsOpen, setDiffOptionsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<{
    available: boolean;
    version?: string;
    url?: string;
  } | null>(null);
  const [platform, setPlatform] = useState<string | undefined>(undefined);

  const confirmOverwriteOnCopy = usePreferencesStore(
    (s) => s.confirmOverwriteOnCopy,
  );
  const setPreferences = usePreferencesStore((s) => s.setPreferences);

  // Fetch platform once on mount.
  useEffect(() => {
    void (async () => {
      if (!window.awapi) return;
      try {
        const info = await window.awapi.app.getInfo();
        setPlatform(info.platform);
      } catch {
        // non-critical — shell section simply won't appear
      }
    })();
  }, []);

  // Load global rules from main on mount.
  useEffect(() => {
    if (rulesLoaded) return;
    void (async () => {
      try {
        if (!window.awapi) {
          console.warn(
            '[awapi] window.awapi is undefined — restart `just dev` to pick up preload/main changes.',
          );
          return;
        }
        const rules = (await window.awapi.rules.get()) ?? [];
        setGlobalRules(rules);
      } finally {
        markRulesLoaded();
      }
    })();
  }, [rulesLoaded, setGlobalRules, markRulesLoaded]);

  // Pre-populate the first compare tab from CLI args (highest priority)
  // or, as a fallback, restore the last persisted session. Runs once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!window.awapi) return;
      const firstCompareTab = useWorkspaceStore
        .getState()
        .tabs.find((t) => t.kind === 'compare');
      if (!firstCompareTab) return;
      const session = getSessionStore(firstCompareTab.id).getState();
      // Don't clobber an in-progress edit (e.g. HMR re-mount).
      if (session.leftRoot || session.rightRoot) return;

      // 1. Try CLI args.
      try {
        const initial = await window.awapi.app?.getInitialCompare?.();
        if (!cancelled && initial) {
          session.setLeftRoot(initial.leftRoot);
          if (initial.rightRoot) session.setRightRoot(initial.rightRoot);
          session.setMode(initial.mode);
          return;
        }
      } catch (err) {
        console.warn('[awapi] failed to read initial compare:', err);
      }

      // 2. Restore last persisted session.
      if (cancelled) return;
      try {
        const sessions = await window.awapi.session?.list?.();
        if (cancelled || !sessions?.length) return;
        const latest = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) {
          session.loadSnapshot({
            ...latest,
            diffOptions: latest.diffOptions ?? DEFAULT_DIFF_OPTIONS,
          });
        }
      } catch (err) {
        console.warn('[awapi] failed to restore last session:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // The Rules editor's "session" scope edits the active compare tab's
  // session-rules. We grab that session store imperatively (only when
  // the editor is open) so App.tsx itself doesn't subscribe to per-tab
  // state.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeCompareId =
    activeTab?.kind === 'compare'
      ? activeTab.id
      : tabs.find((t) => t.kind === 'compare')?.id ?? null;

  const getActiveSessionRules = (): Rule[] => {
    if (!activeCompareId) return [];
    return getSessionStore(activeCompareId).getState().rules;
  };
  const setActiveSessionRules = (next: Rule[]): void => {
    if (!activeCompareId) return;
    getSessionStore(activeCompareId).getState().setRules(next);
  };

  const getActiveDiffOptions = (): DiffOptions => {
    if (!activeCompareId) return DEFAULT_DIFF_OPTIONS;
    return getSessionStore(activeCompareId).getState().diffOptions;
  };
  const setActiveDiffOptions = (next: DiffOptions): void => {
    if (!activeCompareId) return;
    getSessionStore(activeCompareId).getState().setDiffOptions(next);
  };

  // Prompt the user about unsaved changes on a tab before closing
  // it. Resolves to true when the close should proceed (Save or
  // Don't Save), false on Cancel (or if the requested save fails).
  const confirmTabCloseable = async (id: string): Promise<boolean> => {
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === id);
    if (!tab || !tab.dirty) return true;
    const choice = await window.awapi?.dialog?.confirmUnsaved?.({
      name: tab.title,
    });
    if (choice === 'cancel' || choice === undefined) return false;
    if (choice === 'save') {
      const handler = getTabSaveHandler(id);
      if (!handler) return true;
      try {
        await handler();
      } catch (err) {
        console.error('[awapi] save before close failed:', err);
        return false;
      }
    }
    return true;
  };

  const tryCloseTab = (id: string): void => {
    void (async () => {
      if (await confirmTabCloseable(id)) closeTab(id);
    })();
  };

  // Walk a list of candidate tab ids through the dirty-prompt
  // pipeline; returns the ids the user confirmed (or that were
  // already clean). Stops on the first cancel.
  const collectCloseableIds = async (
    candidates: readonly string[],
  ): Promise<string[]> => {
    const ok: string[] = [];
    for (const id of candidates) {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === id);
      if (!tab) continue;
      if (tab.dirty === true) {
        useWorkspaceStore.getState().setActiveTab(id);
        if (!(await confirmTabCloseable(id))) return ok;
        useWorkspaceStore.getState().setTabDirty(id, false);
      }
      ok.push(id);
    }
    return ok;
  };

  const tryCloseOtherTabs = (id: string): void => {
    void (async () => {
      const candidates = useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.id !== id)
        .map((t) => t.id);
      const confirmed = await collectCloseableIds(candidates);
      const closeOne = useWorkspaceStore.getState().closeTab;
      for (const cid of confirmed) closeOne(cid);
    })();
  };

  const tryCloseAllTabs = (): void => {
    void (async () => {
      const candidates = useWorkspaceStore
        .getState()
        .tabs.map((t) => t.id);
      const confirmed = await collectCloseableIds(candidates);
      const closeOne = useWorkspaceStore.getState().closeTab;
      // closeTab refuses to close the last compare tab; closing the
      // confirmed ids in order naturally preserves the workspace
      // invariant.
      for (const cid of confirmed) closeOne(cid);
    })();
  };

  // Window-close handshake. The main process intercepts the user's
  // close request and emits `app.requestClose`; we walk every dirty
  // tab through the same Save / Don't Save / Cancel prompt, then
  // either tell main to actually close the window or simply ignore
  // (cancel).
  useEffect(() => {
    if (!window.awapi?.app?.onCloseRequest) return;
    return window.awapi.app.onCloseRequest(() => {
      void (async () => {
        const dirtyTabs = useWorkspaceStore
          .getState()
          .tabs.filter((t) => t.dirty === true);
        for (const tab of dirtyTabs) {
          // Focus the dirty tab so the user knows which file the
          // prompt is about.
          useWorkspaceStore.getState().setActiveTab(tab.id);
          if (!(await confirmTabCloseable(tab.id))) return;
          // Mark the tab clean so subsequent close logic doesn't
          // re-prompt.
          useWorkspaceStore.getState().setTabDirty(tab.id, false);
        }
        window.awapi?.app?.closeWindow?.();
      })();
    });
  }, []);

  // Listen for the global Preferences menu action (CmdOrCtrl+,). The
  // listener is mounted once at app level so it works regardless of
  // which tab is currently active.
  useEffect(() => {
    if (!window.awapi?.app?.onMenuAction) return;
    return window.awapi.app.onMenuAction((menuAction) => {
      if (menuAction === 'edit.preferences') setPreferencesOpen(true);
      if (menuAction === 'help.about') setAboutOpen(true);
      if (menuAction === 'help.checkForUpdates') {
        void window.awapi.updater.check().then((result) => {
          setUpdateCheckResult(result);
        });
      }
    });
  }, []);

  // (Shell registration status fetch removed — macOS Finder integration not supported)

  return (
    <div className="awapi-app">
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={tryCloseTab}
        onNewCompareTab={() => openCompareTab()}
        onCloseOthers={tryCloseOtherTabs}
        onCloseAll={tryCloseAllTabs}
      />
      <main className="awapi-app__body">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`awapi-tab-panel${active ? ' awapi-tab-panel--active' : ''}`}
              role="tabpanel"
              hidden={!active}
              aria-hidden={!active}
            >
              {tab.kind === 'compare' ? (
                <CompareTabBody
                  tabId={tab.id}
                  isActive={active}
                  onOpenRules={() => setRulesEditorOpen(true)}
                  onOpenDiffOptions={() => setDiffOptionsOpen(true)}
                />
              ) : (
                <FileDiffTab
                  relPath={tab.relPath}
                  parentCompareTabId={tab.parentCompareTabId}
                  tabId={tab.id}
                  initialLeftPath={tab.initialLeftPath}
                  initialRightPath={tab.initialRightPath}
                  onOpenRules={() => setRulesEditorOpen(true)}
                  onOpenDiffOptions={() => setDiffOptionsOpen(true)}
                />
              )}
            </div>
          );
        })}
      </main>
      {rulesEditorOpen ? (
        <RulesEditor
          scope={rulesScope}
          onScopeChange={setRulesScope}
          rules={rulesScope === 'global' ? globalRules : getActiveSessionRules()}
          onSave={async (next: Rule[]) => {
            if (rulesScope === 'global') {
              setGlobalRules(next);
              await window.awapi?.rules.set(next);
            } else {
              setActiveSessionRules(next);
            }
          }}
          onClose={() => setRulesEditorOpen(false)}
        />
      ) : null}
      {diffOptionsOpen ? (
        <DiffOptionsDialog
          value={getActiveDiffOptions()}
          onSave={(next) => {
            setActiveDiffOptions(next);
            setDiffOptionsOpen(false);
          }}
          onClose={() => setDiffOptionsOpen(false)}
          onOpenRules={() => {
            setDiffOptionsOpen(false);
            setRulesScope('session');
            setRulesEditorOpen(true);
          }}
        />
      ) : null}
      {preferencesOpen ? (
        <PreferencesDialog
          value={{ confirmOverwriteOnCopy }}
          onSave={(next) => {
            setPreferences(next);
            setPreferencesOpen(false);
          }}
          onClose={() => setPreferencesOpen(false)}
          platform={platform}
        />
      ) : null}
      {updateCheckResult !== null ? (
        <UpdateCheckDialog
          available={updateCheckResult.available}
          version={updateCheckResult.version}
          url={updateCheckResult.url}
          onClose={() => setUpdateCheckResult(null)}
        />
      ) : null}
      {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </div>
  );
}
