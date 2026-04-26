import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DEFAULT_DIFF_OPTIONS, mergeDiffOptions, type DiffOptions } from '@awapi/shared';

import { DiffOptionsDialog } from './DiffOptionsDialog.js';

function renderDialog(overrides: Partial<Parameters<typeof DiffOptionsDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const onOpenRules = vi.fn();
  render(
    <DiffOptionsDialog
      value={DEFAULT_DIFF_OPTIONS}
      onSave={onSave}
      onClose={onClose}
      onOpenRules={onOpenRules}
      {...overrides}
    />,
  );
  return { onSave, onClose, onOpenRules };
}

describe('<DiffOptionsDialog />', () => {
  it('renders the Match tab by default with the default values', () => {
    renderDialog();
    expect(screen.getByLabelText(/compare byte size/i)).toBeChecked();
    expect(screen.getByLabelText(/compare modification time/i)).toBeChecked();
    expect(screen.getByLabelText(/tolerance in seconds/i)).toHaveValue(2);
    expect(screen.getByLabelText(/ignore 1-hour daylight-saving offset/i)).not.toBeChecked();
    expect(screen.getByLabelText(/ignore whole-hour timezone offsets/i)).not.toBeChecked();
  });

  it('disables mtime sub-options when the mtime check is off', async () => {
    renderDialog();
    await userEvent.click(screen.getByLabelText(/compare modification time/i));
    const dst = screen.getByLabelText(/ignore 1-hour daylight-saving offset/i);
    // Inside a disabled fieldset.
    expect(dst).toBeDisabled();
  });

  it('switches tabs when a tab button is clicked', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('tab', { name: 'Pairing' }));
    expect(screen.getByLabelText(/match filenames ignoring case/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Content' }));
    expect(screen.getByLabelText(/checksum \(sha-256\)/i)).toBeInTheDocument();
  });

  it('calls onSave with the edited DiffOptions when Save is pressed', async () => {
    const { onSave } = renderDialog();
    // Toggle "Compare byte size" off.
    await userEvent.click(screen.getByLabelText(/compare byte size/i));
    // Switch to Pairing tab and enable case-insensitive pairing.
    await userEvent.click(screen.getByRole('tab', { name: 'Pairing' }));
    await userEvent.click(screen.getByLabelText(/match filenames ignoring case/i));
    // Save.
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0]?.[0] as DiffOptions;
    expect(saved.attributes.size).toBe(false);
    expect(saved.pairing.caseSensitive).toBe(false);
    // Untouched fields preserved.
    expect(saved.attributes.mtime.toleranceSeconds).toBe(
      DEFAULT_DIFF_OPTIONS.attributes.mtime.toleranceSeconds,
    );
  });

  it('Save is disabled until the draft differs from the current value', async () => {
    renderDialog();
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/compare byte size/i));
    expect(save).toBeEnabled();
  });

  it('Cancel calls onClose without saving', async () => {
    const { onClose, onSave } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Misc tab restores defaults when the reset button is clicked', async () => {
    const customised: DiffOptions = mergeDiffOptions({ attributes: { size: false } });
    const { onSave } = renderDialog({ value: customised });
    await userEvent.click(screen.getByRole('tab', { name: 'Misc' }));
    await userEvent.click(screen.getByRole('button', { name: /reset all options to defaults/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const saved = onSave.mock.calls[0]?.[0] as DiffOptions;
    expect(saved.attributes.size).toBe(true);
  });

  it('Filters tab forwards the rules-editor request', async () => {
    const { onOpenRules } = renderDialog();
    await userEvent.click(screen.getByRole('tab', { name: 'Filters' }));
    await userEvent.click(screen.getByRole('button', { name: /open rules editor/i }));
    expect(onOpenRules).toHaveBeenCalledOnce();
  });
});
