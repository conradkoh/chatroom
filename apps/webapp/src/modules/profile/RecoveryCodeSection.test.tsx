import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecoveryCodeSection } from './RecoveryCodeSection';

const mocks = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  regenerate: vi.fn(),
  writeText: vi.fn(),
  sessionId: 'session-1' as string | null,
}));

// Data port: the two recovery actions.
vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useAction: (ref: unknown) =>
      getFunctionName(ref as never) === 'auth:regenerateRecoveryCode'
        ? mocks.regenerate
        : mocks.getOrCreate,
  };
});

// Data port: the session id.
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => [mocks.sessionId, vi.fn()],
}));

let user: ReturnType<typeof userEvent.setup>;

async function revealCode() {
  await user.click(screen.getByRole('button', { name: 'Reveal Recovery Code' }));
}

async function regenerateCode() {
  await user.click(screen.getByRole('button', { name: 'Regenerate Code' }));
  await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
}

describe('RecoveryCodeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionId = 'session-1';
    mocks.getOrCreate.mockResolvedValue({ success: true, recoveryCode: 'OLD-CODE' });
    mocks.writeText.mockResolvedValue(undefined);
    // user-event would otherwise install its own clipboard stub over this mock.
    user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a rejected reveal once as alert text in recovery-feedback', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false, reason: 'Code is unavailable.' });

    render(<RecoveryCodeSection />);
    await revealCode();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Code is unavailable.');
    expect(alert).toHaveAttribute('data-testid', 'recovery-feedback');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText('Code is unavailable.')).toHaveLength(1);
  });

  it('uses the fallback text when a reveal rejection has no reason', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false });

    render(<RecoveryCodeSection />);
    await revealCode();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to retrieve recovery code.');
  });

  it('shows an unexpected reveal failure as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getOrCreate.mockRejectedValueOnce(new Error('boom'));

    render(<RecoveryCodeSection />);
    await revealCode();

    expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');
  });

  it('shows a rejected regenerate as alert text and keeps the old code', async () => {
    mocks.regenerate.mockResolvedValueOnce({
      success: false,
      reason: 'Regeneration is blocked.',
    });

    render(<RecoveryCodeSection />);
    await revealCode();
    await regenerateCode();

    expect(screen.getByRole('alert')).toHaveTextContent('Regeneration is blocked.');
    expect(screen.getByRole('textbox')).toHaveValue('OLD-CODE');
  });

  it('clears the slot when the next reveal attempt starts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getOrCreate.mockRejectedValueOnce(new Error('boom'));

    render(<RecoveryCodeSection />);
    await revealCode();
    expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');

    mocks.getOrCreate.mockImplementation(() => new Promise(() => {}));
    await revealCode();

    expect(screen.queryByTestId('recovery-feedback')).toBeNull();
  });

  it('clears the slot on Dismiss', async () => {
    mocks.getOrCreate.mockResolvedValueOnce({ success: false, reason: 'Code is unavailable.' });

    render(<RecoveryCodeSection />);
    await revealCode();

    const slot = screen.getByTestId('recovery-feedback');
    await user.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('recovery-feedback')).toBeNull();
  });

  it('shows the regenerate success as status text and replaces the textarea', async () => {
    mocks.regenerate.mockResolvedValueOnce({ success: true, recoveryCode: 'NEW-CODE' });

    render(<RecoveryCodeSection />);
    await revealCode();
    await regenerateCode();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Recovery code regenerated successfully!');
    expect(screen.getByRole('textbox')).toHaveValue('NEW-CODE');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the regenerate status on Dismiss', async () => {
    mocks.regenerate.mockResolvedValueOnce({ success: true, recoveryCode: 'NEW-CODE' });

    render(<RecoveryCodeSection />);
    await revealCode();
    await regenerateCode();

    const slot = await screen.findByTestId('recovery-feedback');
    await user.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('copies the code with no message and flips Copy Code to a check icon for 2 s', async () => {
    render(<RecoveryCodeSection />);
    await revealCode();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const copyButton = screen.getByRole('button', { name: 'Copy recovery code' });
    await user.click(copyButton);
    await act(async () => {});

    expect(mocks.writeText).toHaveBeenCalledWith('OLD-CODE');
    expect(copyButton.querySelector('.lucide-check')).not.toBeNull();
    expect(screen.queryByTestId('recovery-feedback')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton.querySelector('.lucide-copy')).not.toBeNull();
    expect(copyButton.querySelector('.lucide-check')).toBeNull();
  });

  it('shows a clipboard rejection as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));

    render(<RecoveryCodeSection />);
    await revealCode();

    await user.click(screen.getByRole('button', { name: 'Copy recovery code' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to copy code.');
    expect(
      screen.getByRole('button', { name: 'Copy recovery code' }).querySelector('.lucide-check')
    ).toBeNull();
  });
});
