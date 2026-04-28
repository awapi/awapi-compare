import { useEffect, useState } from 'react';
import type { JSX } from 'react';

const GITHUB_REPO_URL = 'https://github.com/awapi/awapi-compare';
const GITHUB_PROFILE_URL = 'https://github.com/omeryesil';

export interface AboutDialogProps {
  onClose(): void;
}

export function AboutDialog(props: AboutDialogProps): JSX.Element {
  const { onClose } = props;
  const [info, setInfo] = useState<{
    name: string;
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    arch: string;
  } | null>(null);

  useEffect(() => {
    void window.awapi?.app?.getInfo?.().then(setInfo);
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
        aria-label="About"
      >
        <header className="awapi-modal__header">
          <h2>About {info?.name ?? 'AwapiCompare'}</h2>
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
          {info ? (
            <>
              <p className="awapi-modal__detail">
                Version: {info.version}
                <br />
                Electron: {info.electron}
                <br />
                Chrome: {info.chrome}
                <br />
                Node.js: {info.node}
                <br />
                Platform: {info.platform} {info.arch}
              </p>
              <p>A fast, cross-platform file and directory comparison tool.</p>
              <p>
                <button
                  type="button"
                  className="awapi-link-button"
                  onClick={() => void window.awapi?.app?.openExternal?.(GITHUB_REPO_URL)}
                >
                  {GITHUB_REPO_URL}
                </button>
              </p>
              <p className="awapi-modal__hint">
                Maintainer: Omer Yesil
                <br />
                <button
                  type="button"
                  className="awapi-link-button"
                  onClick={() => void window.awapi?.app?.openExternal?.(GITHUB_PROFILE_URL)}
                >
                  {GITHUB_PROFILE_URL}
                </button>
              </p>
            </>
          ) : null}
        </div>
        <footer className="awapi-modal__footer">
          <button
            type="button"
            onClick={() => void window.awapi?.app?.openExternal?.(GITHUB_REPO_URL)}
          >
            Open Repo
          </button>
          <button
            type="button"
            onClick={() => void window.awapi?.app?.openExternal?.(GITHUB_PROFILE_URL)}
          >
            Open Profile
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
