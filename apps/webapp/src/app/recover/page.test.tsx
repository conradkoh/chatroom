import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RecoverAccountPage from './page';

const mocks = vi.hoisted(() => ({
  verifyCode: vi.fn(),
  refreshSessionId: vi.fn(),
  push: vi.fn(),
  sessionId: 'session-1' as string | null,
}));

vi.mock('convex/react', () => ({
  useAction: () => mocks.verifyCode,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => [mocks.sessionId, mocks.refreshSessionId],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/modules/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

async function submitRecoveryCode() {
  await userEvent.type(screen.getByLabelText('Recovery Code'), 'recovery-code');
  await userEvent.click(screen.getByRole('button', { name: 'Recover Account' }));
}

describe('RecoverAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionId = 'session-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a missing session as alert text and does not call the action', async () => {
    mocks.sessionId = null;

    render(<RecoverAccountPage />);
    await submitRecoveryCode();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session ID is missing. Cannot recover account.'
    );
    expect(mocks.verifyCode).not.toHaveBeenCalled();
  });

  it('shows a rejected code as alert text once and does not redirect', async () => {
    mocks.verifyCode.mockResolvedValueOnce({ success: false, reason: 'invalid_code' });

    render(<RecoverAccountPage />);
    await submitRecoveryCode();

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Invalid recovery code.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows an unexpected failure as alert text and does not redirect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.verifyCode.mockRejectedValueOnce(new Error('boom'));

    render(<RecoverAccountPage />);
    await submitRecoveryCode();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An unexpected error occurred during recovery.'
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('clears the alert when the user edits the code', async () => {
    mocks.sessionId = null;

    render(<RecoverAccountPage />);
    await submitRecoveryCode();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session ID is missing. Cannot recover account.'
    );

    await userEvent.type(screen.getByLabelText('Recovery Code'), 'x');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refreshes the session and redirects on success with no message', async () => {
    mocks.verifyCode.mockResolvedValueOnce({ success: true, user: { _id: 'u1' } });

    render(<RecoverAccountPage />);
    await submitRecoveryCode();

    expect(mocks.verifyCode).toHaveBeenCalledWith({
      recoveryCode: 'recovery-code',
      sessionId: 'session-1',
    });
    expect(mocks.refreshSessionId).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
