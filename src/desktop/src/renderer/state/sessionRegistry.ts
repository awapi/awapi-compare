import { createSessionStore, type SessionStore } from './sessionStore.js';

/**
 * Module-level registry that owns one Zustand session store **per
 * compare tab**. Tabs are independent compare sessions (à la Beyond
 * Compare): each has its own folders, mode, rules, scan state, and
 * selection. The registry survives tab show/hide cycles so component
 * remounts don't lose state; entries are released only when a tab is
 * actually closed.
 */
const stores = new Map<string, SessionStore>();

export function getSessionStore(tabId: string): SessionStore {
  let store = stores.get(tabId);
  if (!store) {
    store = createSessionStore();
    stores.set(tabId, store);
  }
  return store;
}

export function disposeSessionStore(tabId: string): void {
  stores.delete(tabId);
}

/** Test helper. */
export function _resetSessionRegistry(): void {
  stores.clear();
}
