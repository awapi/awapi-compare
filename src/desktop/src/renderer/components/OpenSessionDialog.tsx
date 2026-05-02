import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Session } from '@awapi/shared';

export interface OpenSessionDialogProps {
  onOpen(session: Session): void;
  onClose(): void;
}

export function OpenSessionDialog({ onOpen, onClose }: OpenSessionDialogProps): JSX.Element {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    void window.awapi?.session?.list?.().then((list) => {
      setSessions([...list].sort((a, b) => b.updatedAt - a.updatedAt));
    });
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
        className="awapi-modal awapi-modal--medium"
        role="dialog"
        aria-modal="true"
        aria-label="Open Session"
      >
        <header className="awapi-modal__header">
          <h2>Open Session</h2>
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
          {sessions === null ? (
            <p>Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="awapi-modal__hint">No saved sessions found.</p>
          ) : (
            <ul className="awapi-session-list" role="listbox" aria-label="Saved sessions">
              {sessions.map((s) => (
                <li key={s.id} role="option" aria-selected="false">
                  <button
                    type="button"
                    className="awapi-session-list__item"
                    onClick={() => onOpen(s)}
                  >
                    <span className="awapi-session-list__name">
                      {s.name ?? 'Untitled'}
                    </span>
                    <span className="awapi-session-list__roots">
                      {s.leftRoot || '—'} ↔ {s.rightRoot || '—'}
                    </span>
                    <span className="awapi-session-list__date">
                      {new Date(s.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="awapi-modal__footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
