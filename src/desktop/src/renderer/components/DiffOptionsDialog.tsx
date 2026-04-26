import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';

import {
  DEFAULT_DIFF_OPTIONS,
  cloneDiffOptions,
  type ContentCompareMode,
  type DiffOptions,
} from '@awapi/shared';

export type DiffOptionsTab = 'match' | 'pairing' | 'content' | 'filters' | 'misc';

export interface DiffOptionsDialogProps {
  /** Current options. The dialog edits a draft and only commits on Save. */
  value: DiffOptions;
  /** Persist the edited options. */
  onSave(next: DiffOptions): void;
  /** Close without saving. */
  onClose(): void;
  /**
   * Optional callback wired to the existing Rules editor. When omitted,
   * the *Filters* tab shows a hint instead of the button.
   */
  onOpenRules?(): void;
  /** Tab to open initially. Defaults to `'match'`. */
  initialTab?: DiffOptionsTab;
}

const TABS: ReadonlyArray<{ id: DiffOptionsTab; label: string }> = [
  { id: 'match', label: 'Match' },
  { id: 'pairing', label: 'Pairing' },
  { id: 'content', label: 'Content' },
  { id: 'filters', label: 'Filters' },
  { id: 'misc', label: 'Misc' },
];

const CONTENT_MODES: ReadonlyArray<{ value: ContentCompareMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off (attributes only)', hint: 'Never read file contents.' },
  { value: 'checksum', label: 'Checksum (SHA-256)', hint: 'Hash both files; equal hash = identical.' },
  { value: 'binary', label: 'Binary (byte-by-byte)', hint: 'Compare raw bytes.' },
  { value: 'rules', label: 'Rule-driven', hint: 'Reserved for per-extension content rules.' },
];

export function DiffOptionsDialog(props: DiffOptionsDialogProps): JSX.Element {
  const { value, onSave, onClose, onOpenRules, initialTab = 'match' } = props;
  const [draft, setDraft] = useState<DiffOptions>(() => cloneDiffOptions(value));
  const [tab, setTab] = useState<DiffOptionsTab>(initialTab);

  // Reset the draft if the parent swaps `value` while the dialog is open.
  useEffect(() => {
    setDraft(cloneDiffOptions(value));
  }, [value]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(value), [draft, value]);

  const updateAttributes = (patch: Partial<DiffOptions['attributes']>): void => {
    setDraft((d) => ({ ...d, attributes: { ...d.attributes, ...patch } }));
  };
  const updateMtime = (patch: Partial<DiffOptions['attributes']['mtime']>): void => {
    setDraft((d) => ({
      ...d,
      attributes: { ...d.attributes, mtime: { ...d.attributes.mtime, ...patch } },
    }));
  };
  const updatePairing = (patch: Partial<DiffOptions['pairing']>): void => {
    setDraft((d) => ({ ...d, pairing: { ...d.pairing, ...patch } }));
  };
  const updateContent = (patch: Partial<DiffOptions['content']>): void => {
    setDraft((d) => ({ ...d, content: { ...d.content, ...patch } }));
  };

  const resetDefaults = (): void => setDraft(cloneDiffOptions(DEFAULT_DIFF_OPTIONS));

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="awapi-modal awapi-diffopts"
        role="dialog"
        aria-label="Diff options"
      >
        <header className="awapi-modal__header">
          <h2>Diff options</h2>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onClose}
            aria-label="Close diff options"
          >
            ×
          </button>
        </header>

        <nav className="awapi-diffopts__tabs" role="tablist" aria-label="Diff option sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={`awapi-diffopts__tab${t.id === tab ? ' awapi-diffopts__tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div
          className="awapi-diffopts__body"
          role="tabpanel"
          aria-label={`${tab} tab`}
        >
          {tab === 'match' && (
            <MatchTab
              size={draft.attributes.size}
              mtime={draft.attributes.mtime}
              onChangeSize={(v) => updateAttributes({ size: v })}
              onChangeMtime={updateMtime}
            />
          )}
          {tab === 'pairing' && (
            <PairingTab pairing={draft.pairing} onChange={updatePairing} />
          )}
          {tab === 'content' && (
            <ContentTab content={draft.content} onChange={updateContent} />
          )}
          {tab === 'filters' && <FiltersTab onOpenRules={onOpenRules} />}
          {tab === 'misc' && <MiscTab onResetDefaults={resetDefaults} />}
        </div>

        <footer className="awapi-modal__footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button awapi-button--primary"
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

interface MatchTabProps {
  size: boolean;
  mtime: DiffOptions['attributes']['mtime'];
  onChangeSize(v: boolean): void;
  onChangeMtime(patch: Partial<DiffOptions['attributes']['mtime']>): void;
}

function MatchTab(props: MatchTabProps): JSX.Element {
  const { size, mtime, onChangeSize, onChangeMtime } = props;
  return (
    <section className="awapi-diffopts__section">
      <h3>Attribute checks</h3>
      <p className="awapi-diffopts__hint">
        Used to decide whether two files are equal without reading their
        contents.
      </p>
      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={size}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChangeSize(e.target.checked)}
        />
        Compare byte size
      </label>

      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={mtime.enabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChangeMtime({ enabled: e.target.checked })
          }
        />
        Compare modification time
      </label>

      <fieldset
        className="awapi-diffopts__sub"
        disabled={!mtime.enabled}
        aria-label="Modification-time options"
      >
        <label className="awapi-diffopts__row">
          <span>Tolerance</span>
          <input
            type="number"
            min={0}
            step={1}
            value={mtime.toleranceSeconds}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChangeMtime({ toleranceSeconds: Number(e.target.value) || 0 })
            }
            aria-label="Tolerance in seconds"
          />
          <span>seconds</span>
        </label>

        <label className="awapi-diffopts__row">
          <input
            type="checkbox"
            checked={mtime.ignoreDstShift}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChangeMtime({ ignoreDstShift: e.target.checked })
            }
          />
          Ignore 1-hour daylight-saving offset
        </label>

        <label className="awapi-diffopts__row">
          <input
            type="checkbox"
            checked={mtime.ignoreTimezone}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChangeMtime({ ignoreTimezone: e.target.checked })
            }
          />
          Ignore whole-hour timezone offsets
        </label>
      </fieldset>
    </section>
  );
}

interface PairingTabProps {
  pairing: DiffOptions['pairing'];
  onChange(patch: Partial<DiffOptions['pairing']>): void;
}

function PairingTab({ pairing, onChange }: PairingTabProps): JSX.Element {
  return (
    <section className="awapi-diffopts__section">
      <h3>Filename pairing</h3>
      <p className="awapi-diffopts__hint">
        Controls how entries on the two sides are matched up before they
        are compared.
      </p>
      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={!pairing.caseSensitive}
          onChange={(e) => onChange({ caseSensitive: !e.target.checked })}
        />
        Match filenames ignoring case
      </label>
      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={pairing.ignoreExtension}
          onChange={(e) => onChange({ ignoreExtension: e.target.checked })}
        />
        Pair files with different extensions (foo.ts ↔ foo.js)
      </label>
      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={pairing.unicodeNormalize}
          onChange={(e) => onChange({ unicodeNormalize: e.target.checked })}
        />
        Normalise filenames to NFC before pairing
      </label>
    </section>
  );
}

interface ContentTabProps {
  content: DiffOptions['content'];
  onChange(patch: Partial<DiffOptions['content']>): void;
}

function ContentTab({ content, onChange }: ContentTabProps): JSX.Element {
  return (
    <section className="awapi-diffopts__section">
      <h3>Content comparison</h3>
      <p className="awapi-diffopts__hint">
        How file content is compared when attribute checks are
        inconclusive.
      </p>
      <fieldset
        className="awapi-diffopts__radios"
        aria-label="Content comparison mode"
      >
        {CONTENT_MODES.map((m) => (
          <label key={m.value} className="awapi-diffopts__row">
            <input
              type="radio"
              name="diffopts-content-mode"
              value={m.value}
              checked={content.mode === m.value}
              onChange={() => onChange({ mode: m.value })}
            />
            <span>
              <strong>{m.label}</strong>
              <span className="awapi-diffopts__hint awapi-diffopts__hint--inline">
                {' '}
                — {m.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={content.skipWhenAttributesMatch}
          onChange={(e) => onChange({ skipWhenAttributesMatch: e.target.checked })}
        />
        Skip content read when attributes already match
      </label>
      <label className="awapi-diffopts__row">
        <input
          type="checkbox"
          checked={content.overrideAttributesResult}
          onChange={(e) => onChange({ overrideAttributesResult: e.target.checked })}
        />
        Let content verdict override attribute verdict
      </label>
    </section>
  );
}

function FiltersTab({ onOpenRules }: { onOpenRules?: () => void }): JSX.Element {
  return (
    <section className="awapi-diffopts__section">
      <h3>Filters</h3>
      <p className="awapi-diffopts__hint">
        Per-session include/exclude rules live in the Rules editor.
      </p>
      {onOpenRules ? (
        <button
          type="button"
          className="awapi-button awapi-button--primary"
          onClick={onOpenRules}
        >
          Open Rules editor…
        </button>
      ) : (
        <p className="awapi-diffopts__hint">
          (Open the Rules editor from the toolbar.)
        </p>
      )}
    </section>
  );
}

function MiscTab({ onResetDefaults }: { onResetDefaults: () => void }): JSX.Element {
  return (
    <section className="awapi-diffopts__section">
      <h3>Misc</h3>
      <p className="awapi-diffopts__hint">
        Restore every option on every tab to its factory default.
      </p>
      <button type="button" onClick={onResetDefaults}>
        Reset all options to defaults
      </button>
    </section>
  );
}
