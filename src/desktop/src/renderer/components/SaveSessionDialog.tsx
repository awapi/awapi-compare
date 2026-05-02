import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

export interface SaveSessionDialogProps {
  /** Pre-fill the name input (empty for a brand-new name). */
  initialName: string;
  onSave(name: string): void;
  onClose(): void;
}

export function SaveSessionDialog({ initialName, onSave, onClose }: SaveSessionDialogProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
        aria-label="Save Session"
      >
        <header className="awapi-modal__header">
          <h2>Save Session</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="awapi-modal__body">
          <label className="awapi-save-session__label" htmlFor="awapi-session-name">
            Session name
          </label>
          <input
            id="awapi-session-name"
            ref={inputRef}
            type="text"
            className="awapi-save-session__input"
            value={name}
            placeholder="e.g. v1.2 vs v1.3"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onSave(name.trim());
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
        <footer className="awapi-modal__footer">
          <button
            type="button"
            className="awapi-button--primary"
            disabled={!name.trim()}
            onClick={() => {
              if (name.trim()) onSave(name.trim());
            }}
          >
            Save
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
