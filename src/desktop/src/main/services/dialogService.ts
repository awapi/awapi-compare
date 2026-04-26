import type { BrowserWindow } from 'electron';
import type { DialogPickFolderRequest } from '@awapi/shared';

/**
 * Subset of Electron's `dialog.showOpenDialog` we depend on. Defined
 * locally so the service can be unit-tested without importing Electron.
 */
export interface ShowOpenDialogFn {
  (
    window: BrowserWindow | null,
    options: {
      title?: string;
      defaultPath?: string;
      properties: Array<'openDirectory' | 'createDirectory' | 'dontAddToRecent'>;
    },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface DialogServiceDeps {
  /** Returns the window the dialog should attach to, or `null`. */
  getTargetWindow?: () => BrowserWindow | null;
  /** Injected for tests; defaults to Electron's `dialog.showOpenDialog`. */
  showOpenDialog?: ShowOpenDialogFn;
}

/**
 * Wraps native folder-picker dialogs. Renderer code never touches
 * Electron's `dialog` API directly — it goes through this service via
 * the `dialog.pickFolder` IPC channel.
 */
export class DialogService {
  private readonly getTargetWindow: () => BrowserWindow | null;
  private readonly showOpenDialog: ShowOpenDialogFn;

  constructor(deps: DialogServiceDeps = {}) {
    this.getTargetWindow = deps.getTargetWindow ?? ((): BrowserWindow | null => null);
    // Lazy-resolve Electron only when no override is supplied, so the
    // service stays importable from tests that don't ship Electron.
    this.showOpenDialog =
      deps.showOpenDialog ??
      (async (window, options) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const electron = await import('electron');
        return window
          ? electron.dialog.showOpenDialog(window, options)
          : electron.dialog.showOpenDialog(options);
      });
  }

  async pickFolder(req: DialogPickFolderRequest = {}): Promise<string | null> {
    const result = await this.showOpenDialog(this.getTargetWindow(), {
      title: req.title,
      defaultPath: req.defaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    const [first] = result.filePaths;
    return first ?? null;
  }
}
