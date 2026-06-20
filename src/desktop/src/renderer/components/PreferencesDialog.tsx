import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { ShellIntegrationStatus } from '@awapi/shared';

import { DEFAULT_PREFERENCES, type Preferences } from '../state/preferencesStore.js';

export interface PreferencesDialogProps {
  /** Current preferences. The dialog edits a draft until Save. */
  value: Preferences;
  /** Persist the edited preferences. */
  onSave(next: Preferences): void;
  /** Close without saving. */
  onClose(): void;
  /**
   * Host platform string — reserved for future platform-specific sections.
   */
  platform?: string;
}

/**
 * Modal preferences editor. Currently exposes the small set of UI
 * decisions a user can opt to "remember" from inline confirmation
 * dialogs (e.g. Copy → / ← overwrite confirmation). New preference
 * keys should be added here so users can always re-enable a prompt
 * they previously dismissed with "Don't ask again".
 */
export function PreferencesDialog(props: PreferencesDialogProps): JSX.Element {
  const { value, onSave, onClose, platform } = props;
  const [draft, setDraft] = useState<Preferences>(() => ({ ...value }));
  const [shellStatus, setShellStatus] = useState<ShellIntegrationStatus | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [shellAction, setShellAction] = useState<'enable' | 'disable' | null>(null);
  const [shellNotice, setShellNotice] = useState<string | null>(null);

  const isWindows = platform === 'win32';

  useEffect(() => {
    setDraft({ ...value });
  }, [value]);

  useEffect(() => {
    if (!isWindows) return;
    if (!window.awapi?.shell) {
      setShellError('Shell integration is unavailable in this build.');
      setShellStatus(null);
      return;
    }

    let cancelled = false;
    setShellBusy(true);
    setShellError(null);
    void window.awapi.shell
      .status()
      .then((status) => {
        if (!cancelled) setShellStatus(status);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setShellError(message);
      })
      .finally(() => {
        if (!cancelled) setShellBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isWindows]);

  useEffect(() => {
    if (!shellNotice) return;
    const timer = setTimeout(() => {
      setShellNotice(null);
    }, 3000);

    return () => {
      clearTimeout(timer);
    };
  }, [shellNotice]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(value), [draft, value]);

  const updateShellIntegration = async (enabled: boolean): Promise<void> => {
    if (!window.awapi?.shell) {
      setShellError('Shell integration is unavailable in this build.');
      return;
    }

    setShellBusy(true);
    setShellAction(enabled ? 'enable' : 'disable');
    setShellError(null);
    setShellNotice(null);
    try {
      if (enabled) {
        await window.awapi.shell.register();
      } else {
        await window.awapi.shell.unregister();
      }
      setShellStatus(await window.awapi.shell.status());
      setShellNotice(enabled ? 'Explorer entries enabled.' : 'Explorer entries disabled.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setShellError(message);
    } finally {
      setShellAction(null);
      setShellBusy(false);
    }
  };

  return (
    <div className="awapi-modal__backdrop" role="presentation">
      <div
        className="awapi-modal awapi-modal--small"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
      >
        <header className="awapi-modal__header">
          <h2>Preferences</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onClose}
            aria-label="Close preferences"
          >
            ×
          </button>
        </header>

        <div className="awapi-modal__body">
          <fieldset className="awapi-prefs__group">
            <legend>Folder compare</legend>

            <label className="awapi-modal__checkbox">
              <input
                type="checkbox"
                checked={draft.confirmOverwriteOnCopy}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    confirmOverwriteOnCopy: e.target.checked,
                  }))
                }
              />
              <span>Confirm before overwriting an existing file when copying between sides</span>
            </label>
            <p className="awapi-modal__hint">
              When off, Copy → Right and Copy ← Left silently replace destination files. Toggle this
              back on at any time to restore the confirmation prompt.
            </p>
          </fieldset>

          {isWindows ? (
            <fieldset className="awapi-prefs__group">
              <legend>Windows Explorer</legend>
              <p className="awapi-modal__hint">
                Shell Integration status:{' '}
                {shellStatus === null
                  ? 'Unknown'
                  : shellStatus.scope === 'per-user'
                    ? 'Enabled (per-user)'
                    : shellStatus.scope === 'per-machine'
                      ? 'Enabled (per-machine)'
                      : 'Disabled'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void updateShellIntegration(true)}
                  disabled={shellBusy || shellStatus?.enabled === true}
                >
                  {shellBusy && shellAction === 'enable'
                    ? 'Enabling Explorer Entries...'
                    : 'Enable Explorer Entries'}
                </button>
                <button
                  type="button"
                  onClick={() => void updateShellIntegration(false)}
                  disabled={shellBusy || shellStatus?.enabled === false}
                >
                  {shellBusy && shellAction === 'disable'
                    ? 'Disabling Explorer Entries...'
                    : 'Disable Explorer Entries'}
                </button>
              </div>
              {shellBusy ? (
                <p className="awapi-modal__hint" role="status" aria-live="polite">
                  Applying Windows Explorer integration changes. This can take up to 40 seconds.
                </p>
              ) : null}
              {shellNotice ? (
                <p className="awapi-modal__hint" role="status" aria-live="polite">
                  {shellNotice}
                </p>
              ) : null}
              {shellError ? <p className="awapi-modal__hint">{shellError}</p> : null}
            </fieldset>
          ) : null}
        </div>

        <footer className="awapi-modal__footer">
          <button type="button" onClick={() => setDraft({ ...DEFAULT_PREFERENCES })}>
            Reset to defaults
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button--primary"
            disabled={!dirty}
            onClick={() => onSave(draft)}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
