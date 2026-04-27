import { statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { BrowserWindow } from 'electron';
import type {
  DialogConfirmUnsavedChoice,
  DialogConfirmUnsavedRequest,
  DialogPickFileRequest,
  DialogPickFolderRequest,
} from '@awapi/shared';

/**
 * Subset of `node:fs` we need at runtime. Lifted to an interface so
 * tests can supply an in-memory shim without `memfs`.
 */
export interface DialogFsStat {
  (path: string): { isDirectory(): boolean };
}

/**
 * Normalize a user-supplied folder path into something Electron's
 * `showOpenDialog` will actually honor on macOS:
 *
 * - Trim surrounding whitespace.
 * - Resolve relative paths against the current working directory.
 * - Walk up to the nearest existing ancestor directory; Electron
 *   silently ignores `defaultPath` when the path does not exist.
 *
 * Returns `undefined` when no usable path can be derived.
 */
export function resolveDefaultPath(
  raw: string | undefined,
  stat: DialogFsStat,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let candidate = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  // Cap iterations defensively so a pathological input cannot loop.
  for (let i = 0; i < 64; i += 1) {
    try {
      if (stat(candidate).isDirectory()) return candidate;
    } catch {
      // fallthrough: walk up
    }
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
  return undefined;
}

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
      properties: Array<
        'openDirectory' | 'openFile' | 'createDirectory' | 'dontAddToRecent'
      >;
    },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * Subset of Electron's `dialog.showMessageBox` we depend on. Defined
 * locally so the service can be unit-tested without importing
 * Electron.
 */
export interface ShowMessageBoxFn {
  (
    window: BrowserWindow | null,
    options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      buttons?: string[];
      defaultId?: number;
      cancelId?: number;
      title?: string;
      message: string;
      detail?: string;
      noLink?: boolean;
    },
  ): Promise<{ response: number; checkboxChecked: boolean }>;
}

export interface DialogServiceDeps {
  /** Returns the window the dialog should attach to, or `null`. */
  getTargetWindow?: () => BrowserWindow | null;
  /** Injected for tests; defaults to Electron's `dialog.showOpenDialog`. */
  showOpenDialog?: ShowOpenDialogFn;
  /** Injected for tests; defaults to Electron's `dialog.showMessageBox`. */
  showMessageBox?: ShowMessageBoxFn;
  /** Injected for tests; defaults to `fs.statSync`. */
  stat?: DialogFsStat;
}

/**
 * Wraps native folder-picker dialogs. Renderer code never touches
 * Electron's `dialog` API directly — it goes through this service via
 * the `dialog.pickFolder` IPC channel.
 */
export class DialogService {
  private readonly getTargetWindow: () => BrowserWindow | null;
  private readonly showOpenDialog: ShowOpenDialogFn;
  private readonly showMessageBox: ShowMessageBoxFn;
  private readonly stat: DialogFsStat;

  constructor(deps: DialogServiceDeps = {}) {
    this.getTargetWindow = deps.getTargetWindow ?? ((): BrowserWindow | null => null);
    this.stat =
      deps.stat ??
      ((path: string) => statSync(path));
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
    this.showMessageBox =
      deps.showMessageBox ??
      (async (window, options) => {
        const electron = await import('electron');
        return window
          ? electron.dialog.showMessageBox(window, options)
          : electron.dialog.showMessageBox(options);
      });
  }

  async pickFolder(req: DialogPickFolderRequest = {}): Promise<string | null> {
    const result = await this.showOpenDialog(this.getTargetWindow(), {
      title: req.title,
      defaultPath: resolveDefaultPath(req.defaultPath, this.stat),
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    const [first] = result.filePaths;
    return first ?? null;
  }

  async pickFile(req: DialogPickFileRequest = {}): Promise<string | null> {
    const result = await this.showOpenDialog(this.getTargetWindow(), {
      title: req.title,
      defaultPath: resolveDefaultPath(req.defaultPath, this.stat),
      properties: ['openFile', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    const [first] = result.filePaths;
    return first ?? null;
  }

  /**
   * Show a native 3-button "unsaved changes" prompt. Button order
   * matches the platform convention enforced by Electron: on macOS
   * Save is the default (response 0) and Cancel sits between Save
   * and Don't Save; on other platforms the same order works fine.
   * The mapping below normalises Electron's response index back into
   * a stable {@link DialogConfirmUnsavedChoice}.
   */
  async confirmUnsaved(
    req: DialogConfirmUnsavedRequest = {},
  ): Promise<DialogConfirmUnsavedChoice> {
    const message = req.name
      ? `Do you want to save the changes you made to ${req.name}?`
      : 'Do you want to save your changes?';
    const result = await this.showMessageBox(this.getTargetWindow(), {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: req.title ?? 'Unsaved changes',
      message,
      detail: req.detail ?? "Your changes will be lost if you don't save them.",
      noLink: true,
    });
    if (result.response === 0) return 'save';
    if (result.response === 1) return 'discard';
    return 'cancel';
  }
}
