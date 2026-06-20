import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { PreferencesDialog } from './PreferencesDialog.js';
import { DEFAULT_PREFERENCES } from '../state/preferencesStore.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockShellApi(overrides?: Partial<typeof window.awapi.shell>): void {
  Object.defineProperty(window, 'awapi', {
    configurable: true,
    writable: true,
    value: {
      shell: {
        status: vi.fn(async () => ({ enabled: false, scope: 'disabled' })),
        register: vi.fn(async () => {}),
        unregister: vi.fn(async () => {}),
        ...overrides,
      },
    },
  });
}

describe('<PreferencesDialog />', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    render(<PreferencesDialog value={DEFAULT_PREFERENCES} onSave={vi.fn()} onClose={vi.fn()} />);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(save.disabled).toBe(false);
  });

  it('emits the edited preferences on Save', () => {
    const onSave = vi.fn();
    render(<PreferencesDialog value={DEFAULT_PREFERENCES} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ confirmOverwriteOnCopy: false });
  });

  it('does not close when clicking the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PreferencesDialog value={DEFAULT_PREFERENCES} onSave={vi.fn()} onClose={onClose} />,
    );

    const backdrop = container.querySelector('.awapi-modal__backdrop');
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from explicit controls (X and Cancel)', () => {
    const onClose = vi.fn();
    render(<PreferencesDialog value={DEFAULT_PREFERENCES} onSave={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close preferences' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(2);
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

  it('shows Windows shell integration status when platform is win32', async () => {
    mockShellApi({
      status: vi.fn(async () => ({ enabled: true, scope: 'per-user' })),
    });

    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={vi.fn()}
        onClose={vi.fn()}
        platform="win32"
      />,
    );

    expect(await screen.findByText('Shell Integration status: Enabled (per-user)')).toBeTruthy();
  });

  it('invokes shell.register from the Windows section', async () => {
    const register = vi.fn(async () => {});
    const status = vi
      .fn()
      .mockResolvedValueOnce({ enabled: false, scope: 'disabled' })
      .mockResolvedValueOnce({ enabled: true, scope: 'per-user' });
    mockShellApi({ register, status });

    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={vi.fn()}
        onClose={vi.fn()}
        platform="win32"
      />,
    );

    const enable = await screen.findByRole('button', {
      name: 'Enable Explorer Entries',
    });
    fireEvent.click(enable);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await screen.findByText('Shell Integration status: Enabled (per-user)');
  });

  it('shows progress feedback while Explorer integration updates are running', async () => {
    const registerDeferred = deferred<void>();
    const register = vi.fn(() => registerDeferred.promise);
    const status = vi
      .fn()
      .mockResolvedValueOnce({ enabled: false, scope: 'disabled' })
      .mockResolvedValueOnce({ enabled: true, scope: 'per-user' });
    mockShellApi({ register, status });

    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={vi.fn()}
        onClose={vi.fn()}
        platform="win32"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Enable Explorer Entries' }));

    expect(screen.getByRole('button', { name: 'Enabling Explorer Entries...' })).toBeTruthy();
    expect(
      screen.getByText(
        'Applying Windows Explorer integration changes. This can take up to 40 seconds.',
      ),
    ).toBeTruthy();

    registerDeferred.resolve();

    await screen.findByText('Shell Integration status: Enabled (per-user)');
  });

  it('shows and auto-hides a success notice after enabling Explorer entries', async () => {
    const register = vi.fn(async () => {});
    const status = vi
      .fn()
      .mockResolvedValueOnce({ enabled: false, scope: 'disabled' })
      .mockResolvedValueOnce({ enabled: true, scope: 'per-user' });
    mockShellApi({ register, status });

    render(
      <PreferencesDialog
        value={DEFAULT_PREFERENCES}
        onSave={vi.fn()}
        onClose={vi.fn()}
        platform="win32"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Enable Explorer Entries' }));
    await screen.findByText('Explorer entries enabled.');

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 3200);
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Explorer entries enabled.')).toBeNull();
    });
  });
});
