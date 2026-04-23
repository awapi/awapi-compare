import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';

import type { Rule, RuleKind, RuleTarget, RuleVerdict } from '@awapi/shared';

import { DEFAULT_SAMPLE_PATHS, previewVerdicts } from '../state/rulesStore.js';

export type RulesScope = 'global' | 'session';

export interface RulesEditorProps {
  /** Currently active rule scope; controls which list is being edited. */
  scope: RulesScope;
  onScopeChange(scope: RulesScope): void;
  /** Current rule list for the active scope. */
  rules: Rule[];
  /** Persist the edited rule list back to the active scope. */
  onSave(rules: Rule[]): Promise<void> | void;
  /** Close the editor without saving. */
  onClose(): void;
  /**
   * Test-seam: override the live-preview evaluator so component tests
   * don't depend on `window.awapi`. Defaults to {@link previewVerdicts}.
   */
  evaluate?: (rules: Rule[], samples: string[]) => Promise<RuleVerdict[]>;
}

interface DraftRule extends Rule {
  /** Stable key for React reordering; not persisted. */
  _key: string;
}

let draftSeq = 0;
function toDraft(r: Rule): DraftRule {
  return { ...r, _key: `d${++draftSeq}` };
}
function fromDraft(d: DraftRule): Rule {
  // Strip the React-only `_key`.
  const { _key, ...rule } = d;
  void _key;
  return rule;
}

function newRule(): DraftRule {
  return toDraft({
    id: cryptoId(),
    kind: 'exclude',
    pattern: '',
    target: 'path',
    enabled: true,
  });
}

function cryptoId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `r_${Math.random().toString(36).slice(2)}`;
}

export function RulesEditor(props: RulesEditorProps): JSX.Element {
  const { scope, onScopeChange, rules, onSave, onClose, evaluate } = props;
  const evalFn =
    evaluate ??
    ((r: Rule[], s: string[]) =>
      previewVerdicts({ rules: r, samples: s.map((relPath) => ({ relPath })) }));

  const [drafts, setDrafts] = useState<DraftRule[]>(() => rules.map(toDraft));
  const [samplesText, setSamplesText] = useState<string>(
    DEFAULT_SAMPLE_PATHS.join('\n'),
  );
  const [verdicts, setVerdicts] = useState<RuleVerdict[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Reset drafts when the underlying scope/list changes.
  useEffect(() => {
    setDrafts(rules.map(toDraft));
  }, [rules, scope]);

  const samples = useMemo(
    () =>
      samplesText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [samplesText],
  );

  // Re-evaluate whenever drafts or samples change.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const enabled = drafts.filter((d) => d.enabled).map(fromDraft);
      const out = await evalFn(enabled, samples);
      if (!cancelled) setVerdicts(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [drafts, samples, evalFn]);

  const updateDraft = (key: string, patch: Partial<DraftRule>): void => {
    setDrafts((arr) => arr.map((d) => (d._key === key ? { ...d, ...patch } : d)));
  };

  const removeDraft = (key: string): void => {
    setDrafts((arr) => arr.filter((d) => d._key !== key));
  };

  const move = (key: string, delta: -1 | 1): void => {
    setDrafts((arr) => {
      const idx = arr.findIndex((d) => d._key === key);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= arr.length) return arr;
      const next = arr.slice();
      const [item] = next.splice(idx, 1);
      if (!item) return arr;
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(drafts.map(fromDraft));
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="awapi-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="awapi-modal awapi-rules-editor"
        role="dialog"
        aria-label="Rules editor"
      >
        <header className="awapi-modal__header">
          <h2>Rules</h2>
          <fieldset
            className="awapi-rules-editor__scope"
            aria-label="Rule scope"
          >
            <label>
              <input
                type="radio"
                name="rules-scope"
                value="global"
                checked={scope === 'global'}
                onChange={() => onScopeChange('global')}
              />
              Global
            </label>
            <label>
              <input
                type="radio"
                name="rules-scope"
                value="session"
                checked={scope === 'session'}
                onChange={() => onScopeChange('session')}
              />
              This session
            </label>
          </fieldset>
          <button
            type="button"
            className="awapi-modal__close"
            onClick={onClose}
            aria-label="Close rules editor"
          >
            ×
          </button>
        </header>

        <div className="awapi-rules-editor__body">
          <section
            className="awapi-rules-editor__list"
            aria-label="Rule list"
          >
            <div className="awapi-rules-editor__list-header">
              <span>Rules are evaluated top-to-bottom; the last match wins.</span>
              <button
                type="button"
                onClick={() => setDrafts((arr) => [...arr, newRule()])}
              >
                + Add rule
              </button>
            </div>
            {drafts.length === 0 ? (
              <p className="awapi-rules-editor__empty">
                No rules. Everything will be included.
              </p>
            ) : (
              <ol className="awapi-rules-editor__rows">
                {drafts.map((d, i) => (
                  <RuleRow
                    key={d._key}
                    draft={d}
                    index={i}
                    canMoveUp={i > 0}
                    canMoveDown={i < drafts.length - 1}
                    onChange={(patch) => updateDraft(d._key, patch)}
                    onRemove={() => removeDraft(d._key)}
                    onMoveUp={() => move(d._key, -1)}
                    onMoveDown={() => move(d._key, 1)}
                  />
                ))}
              </ol>
            )}
          </section>

          <section
            className="awapi-rules-editor__preview"
            aria-label="Live preview"
          >
            <h3>Preview</h3>
            <p className="awapi-rules-editor__hint">
              One sample path per line. Each is evaluated against the
              current draft.
            </p>
            <textarea
              aria-label="Sample paths"
              rows={Math.max(samples.length + 2, 6)}
              value={samplesText}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setSamplesText(e.target.value)
              }
            />
            <ul className="awapi-rules-editor__verdicts">
              {samples.map((s, i) => {
                const v = verdicts[i] ?? 'kept';
                return (
                  <li
                    key={`${s}-${i}`}
                    className={`awapi-rules-editor__verdict awapi-rules-editor__verdict--${v}`}
                    data-verdict={v}
                  >
                    <span className="awapi-rules-editor__verdict-label">{v}</span>
                    <code>{s}</code>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <footer className="awapi-modal__footer">
          {savedAt ? (
            <span className="awapi-rules-editor__saved" role="status">
              Saved.
            </span>
          ) : null}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="awapi-button awapi-button--primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface RuleRowProps {
  draft: DraftRule;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange(patch: Partial<DraftRule>): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
}

function RuleRow(props: RuleRowProps): JSX.Element {
  const { draft, index, canMoveUp, canMoveDown, onChange, onRemove, onMoveUp, onMoveDown } =
    props;
  const target: RuleTarget = draft.target ?? 'path';

  return (
    <li className="awapi-rules-editor__row" aria-label={`Rule ${index + 1}`}>
      <div className="awapi-rules-editor__row-main">
        <input
          type="checkbox"
          aria-label="Enabled"
          checked={draft.enabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange({ enabled: e.target.checked })
          }
        />
        <select
          aria-label="Kind"
          value={draft.kind}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange({ kind: e.target.value as RuleKind })
          }
        >
          <option value="include">include</option>
          <option value="exclude">exclude</option>
        </select>
        <select
          aria-label="Target"
          value={target}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange({ target: e.target.value as RuleTarget })
          }
        >
          <option value="path">path</option>
          <option value="name">name</option>
        </select>
        <input
          type="text"
          aria-label="Pattern"
          placeholder="e.g. **/*.log"
          value={draft.pattern}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange({ pattern: e.target.value })
          }
        />
        <button
          type="button"
          aria-label={`Move rule ${index + 1} up`}
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move rule ${index + 1} down`}
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Delete rule ${index + 1}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      <div className="awapi-rules-editor__row-predicates">
        <PredicateField
          label="size >"
          value={draft.size?.gt}
          onChange={(v) =>
            onChange({
              size: collapseRange({ ...(draft.size ?? {}), gt: v }),
            })
          }
        />
        <PredicateField
          label="size <"
          value={draft.size?.lt}
          onChange={(v) =>
            onChange({
              size: collapseRange({ ...(draft.size ?? {}), lt: v }),
            })
          }
        />
        <PredicateField
          label="mtime after (ms)"
          value={draft.mtime?.after}
          onChange={(v) =>
            onChange({
              mtime: collapseRange({ ...(draft.mtime ?? {}), after: v }),
            })
          }
        />
        <PredicateField
          label="mtime before (ms)"
          value={draft.mtime?.before}
          onChange={(v) =>
            onChange({
              mtime: collapseRange({ ...(draft.mtime ?? {}), before: v }),
            })
          }
        />
      </div>
    </li>
  );
}

interface PredicateFieldProps {
  label: string;
  value: number | undefined;
  onChange(value: number | undefined): void;
}

function PredicateField(props: PredicateFieldProps): JSX.Element {
  const { label, value, onChange } = props;
  return (
    <label className="awapi-rules-editor__predicate">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}

function collapseRange<T extends Record<string, number | undefined>>(
  range: T,
): T | undefined {
  const hasAny = Object.values(range).some((v) => v !== undefined);
  return hasAny ? range : undefined;
}
