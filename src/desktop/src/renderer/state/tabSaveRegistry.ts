/**
 * Per-tab "save all dirty sides" handler registry. Each
 * `FileDiffTab` registers its handler on mount (and unregisters on
 * unmount); `App.tsx`'s close-and-quit flow looks up the handler so
 * it can flush a tab's edits in response to the user picking "Save"
 * on the unsaved-changes prompt.
 *
 * The handler resolves once every dirty side has been written to
 * disk (or rejects if any save fails — the close flow then aborts so
 * we don't lose the user's work).
 */
export type TabSaveHandler = () => Promise<void>;

const handlers = new Map<string, TabSaveHandler>();

export function registerTabSaveHandler(id: string, handler: TabSaveHandler): void {
  handlers.set(id, handler);
}

export function unregisterTabSaveHandler(id: string): void {
  handlers.delete(id);
}

export function getTabSaveHandler(id: string): TabSaveHandler | undefined {
  return handlers.get(id);
}
