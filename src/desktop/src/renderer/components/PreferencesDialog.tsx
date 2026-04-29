import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import {
  DEFAULT_PREFERENCES,
  type Preferences,
} from '../state/preferencesStore.js';

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
  const {
    value,
    onSave,
    onClose,
  } = props;
  const [draft, setDraft] = useState<Preferences>(() => ({ ...value }));

  useEffect(() => {
    setDraft({ ...value });
  }, [value]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(value),
    [draft, value],
  );

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
              <span>
                Confirm before overwriting an existing file when copying
                between sides
              </span>
            </label>
            <p className="awapi-modal__hint">
              When off, Copy → Right and Copy ← Left silently replace
              destination files. Toggle this back on at any time to
              restore the confirmation prompt.
            </p>
          </fieldset>
        </div>

        <footer className="awapi-modal__footer">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_PREFERENCES })}
          >
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
