import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { CompareTabBody } from './components/CompareTabBody.js';
import { FileDiffTab } from './components/FileDiffTab.js';
import { Tabs } from './components/Tabs.js';
import { RulesEditor, type RulesScope } from './components/RulesEditor.js';
import { useRulesStore, useThemeStore, useWorkspaceStore } from './state/stores.js';
import { getSessionStore } from './state/sessionRegistry.js';
import type { Rule } from '@awapi/shared';

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

  // Pre-populate the first compare tab from CLI args / env vars at
  // launch (e.g. `awapi-compare --type folder --left ./a --right ./b`).
  // Runs exactly once per renderer instance.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!window.awapi?.app?.getInitialCompare) return;
      try {
        const initial = await window.awapi.app.getInitialCompare();
        if (cancelled || !initial) return;
        const firstCompareTab = useWorkspaceStore
          .getState()
          .tabs.find((t) => t.kind === 'compare');
        if (!firstCompareTab) return;
        const session = getSessionStore(firstCompareTab.id).getState();
        // Don't clobber an in-progress edit (e.g. HMR re-mount).
        if (session.leftRoot || session.rightRoot) return;
        session.setLeftRoot(initial.leftRoot);
        session.setRightRoot(initial.rightRoot);
        session.setMode(initial.mode);
      } catch (err) {
        console.warn('[awapi] failed to read initial compare:', err);
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

  return (
    <div className="awapi-app">
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={closeTab}
        onNewCompareTab={() => openCompareTab()}
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
                />
              ) : (
                <FileDiffTab
                  relPath={tab.relPath}
                  parentCompareTabId={tab.parentCompareTabId}
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
    </div>
  );
}
