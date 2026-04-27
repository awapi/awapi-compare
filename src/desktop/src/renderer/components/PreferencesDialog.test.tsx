import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { PreferencesDialog } from './PreferencesDialog.js';
import { DEFAULT_PREFERENCES } from '../state/preferencesStore.js';

describe('<PreferencesDialog />', () => {
  it('renders the current confirmOverwriteOnCopy value', () => {
    render(
      <PreferencesDialog
        value={{ confirmOverwriteOnCopy: false }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('disables Save until the draft differs from the value', () => {
    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(save.disabled).toBe(false);
  });

  it('emits the edited preferences on Save', () => {
    const onSave = vi.fn();
    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ confirmOverwriteOnCopy: false });
  });

  it('Reset to defaults restores the original draft and re-enables Save when needed', () => {
    const onSave = vi.fn();
    render(
      <PreferencesDialog
        value={{ confirmOverwriteOnCopy: false }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_PREFERENCES);
  });
});
