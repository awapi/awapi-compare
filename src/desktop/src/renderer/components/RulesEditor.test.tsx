import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Rule, RuleVerdict } from '@awapi/shared';

import { RulesEditor } from './RulesEditor.js';

function makeEvaluate(): (rules: Rule[], samples: string[]) => Promise<RuleVerdict[]> {
  // Tiny synchronous stand-in: any rule whose pattern equals the sample
  // (or sample's basename) excludes that sample.
  return async (rules, samples) => {
    return samples.map((s) => {
      const enabled = rules.filter((r) => r.enabled);
      let verdict: RuleVerdict = 'kept';
      for (const r of enabled) {
        const subject = r.target === 'name' ? (s.split('/').pop() ?? s) : s;
        if (r.pattern === subject) {
          verdict = r.kind === 'include' ? 'kept' : 'excluded';
        }
      }
      return verdict;
    });
  };
}

function renderEditor(overrides: Partial<Parameters<typeof RulesEditor>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const onScopeChange = vi.fn();
  render(
    <RulesEditor
      scope="global"
      onScopeChange={onScopeChange}
      rules={[]}
      onSave={onSave}
      onClose={onClose}
      evaluate={makeEvaluate()}
      {...overrides}
    />,
  );
  return { onSave, onClose, onScopeChange };
}

async function switchToAdvanced(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: /advanced/i }));
}

describe('<RulesEditor />', () => {
  it('renders an empty-state hint when there are no rules', async () => {
    renderEditor();
    await switchToAdvanced();
    expect(
      screen.getByText(/no rules\. everything will be included\./i),
    ).toBeInTheDocument();
  });

  it('lists existing rules with their pattern, kind, and target', async () => {
    const rules: Rule[] = [
      {
        id: 'r1',
        kind: 'exclude',
        pattern: '**/*.log',
        target: 'path',
        enabled: true,
      },
    ];
    renderEditor({ rules });
    // Mixed scopes / non-canonical shape ⇒ Advanced is the initial tab.
    const row = screen.getByLabelText('Rule 1');
    expect(within(row).getByLabelText(/pattern/i)).toHaveValue('**/*.log');
    expect(within(row).getByLabelText(/kind/i)).toHaveValue('exclude');
    expect(within(row).getByLabelText(/target/i)).toHaveValue('path');
  });

  it('adds a new draft rule on "Add rule" without saving immediately', async () => {
    const { onSave } = renderEditor();
    await switchToAdvanced();
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(screen.getByLabelText('Rule 1')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the edited rule list', async () => {
    const { onSave } = renderEditor();
    await switchToAdvanced();
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));

    const row = screen.getByLabelText('Rule 1');
    await userEvent.type(within(row).getByLabelText(/pattern/i), 'README.md');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.pattern).toBe('README.md');
    expect(saved[0]?.kind).toBe('exclude');
    expect(saved[0]?.enabled).toBe(true);
  });

  it('reorders rules with the up/down buttons', async () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'exclude', pattern: 'first', enabled: true },
      { id: 'r2', kind: 'exclude', pattern: 'second', enabled: true },
    ];
    const { onSave } = renderEditor({ rules });
    await switchToAdvanced();

    await userEvent.click(
      screen.getByRole('button', { name: /move rule 2 up/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved.map((r) => r.pattern)).toEqual(['second', 'first']);
  });

  it('removes a rule via its delete button', async () => {
    const rules: Rule[] = [
      { id: 'r1', kind: 'exclude', pattern: 'gone', enabled: true },
    ];
    const { onSave } = renderEditor({ rules });
    await switchToAdvanced();
    await userEvent.click(screen.getByRole('button', { name: /delete rule 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved).toEqual([]);
  });

  it('switches scope via the radio group', async () => {
    const { onScopeChange } = renderEditor();
    await userEvent.click(screen.getByLabelText(/this session/i));
    expect(onScopeChange).toHaveBeenCalledWith('session');
  });

  it('renders verdicts from the live preview evaluator', async () => {
    renderEditor({
      rules: [
        { id: 'r1', kind: 'exclude', pattern: 'README.md', enabled: true },
      ],
    });
    const verdict = await screen.findByText(
      (_text, el) =>
        el?.tagName === 'CODE' && el.textContent === 'README.md',
    );
    const li = verdict.closest('li');
    expect(li).not.toBeNull();
    expect(li?.getAttribute('data-verdict')).toBe('excluded');
  });

  it('closes via the close (×) button', async () => {
    const { onClose } = renderEditor();
    await userEvent.click(
      screen.getByRole('button', { name: /close rules editor/i }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<RulesEditor /> — Simple tab (Phase 6.1)', () => {
  it('opens on the Simple tab by default for an empty rule set', () => {
    renderEditor();
    expect(screen.getByRole('tab', { name: /simple/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText(/include files/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/exclude files/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/include folders/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/exclude folders/i)).toBeInTheDocument();
  });

  it('typing in Exclude folders compiles to a name+path pair on Save', async () => {
    const { onSave } = renderEditor();
    const box = screen.getByLabelText(/exclude folders/i);
    await userEvent.clear(box);
    await userEvent.type(box, '.git');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      kind: 'exclude',
      target: 'name',
      scope: 'folder',
      pattern: '.git',
    });
    expect(saved[1]).toMatchObject({
      kind: 'exclude',
      target: 'path',
      pattern: '**/.git/**',
    });
  });

  it('typing in Exclude files compiles to a single file-scoped rule on Save', async () => {
    const { onSave } = renderEditor();
    const box = screen.getByLabelText(/exclude files/i);
    await userEvent.type(box, '*.log');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: 'exclude',
      target: 'name',
      scope: 'file',
      pattern: '*.log',
    });
  });

  it('switching to Advanced preserves edits made in Simple', async () => {
    const { onSave } = renderEditor();
    await userEvent.type(screen.getByLabelText(/exclude files/i), '*.log');
    await switchToAdvanced();

    const row = screen.getByLabelText('Rule 1');
    expect(within(row).getByLabelText(/pattern/i)).toHaveValue('*.log');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const saved = onSave.mock.calls[0]?.[0] as Rule[];
    expect(saved[0]?.pattern).toBe('*.log');
  });

  it('shows the "edit in Advanced" banner for rule sets that use advanced features', async () => {
    const rules: Rule[] = [
      {
        id: 'r1',
        kind: 'exclude',
        pattern: '**/*.log',
        target: 'path',
        size: { gt: 1024 },
        enabled: true,
      },
    ];
    renderEditor({ rules });
    // Initial tab is Advanced because the rule set is not representable.
    await userEvent.click(screen.getByRole('tab', { name: /^simple$/i }));
    expect(
      screen.getByTestId('simple-unavailable-banner'),
    ).toBeInTheDocument();
    // The banner offers a one-click escape hatch back to Advanced.
    await userEvent.click(
      within(screen.getByTestId('simple-unavailable-banner')).getByRole(
        'button',
        { name: /advanced/i },
      ),
    );
    expect(screen.getByRole('tab', { name: /advanced/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
