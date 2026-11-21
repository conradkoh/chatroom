import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RecoverAccountPage from './page';

const mocks = vi.hoisted(() => ({
  verifyCode: vi.fn(),
  refreshSessionId: vi.fn(),
  push: vi.fn(),
  sessionId: 'session-1' as string | null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { auth: { verifyRecoveryCode: 'auth:verifyRecoveryCode' } },
}));
vi.mock('convex/react', () => ({ useAction: () => mocks.verifyCode }));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => [mocks.sessionId, mocks.refreshSessionId],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/modules/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const INVALID_CODE_MESSAGE = 'Invalid recovery code.';

function renderPage() {
  render(<RecoverAccountPage />);
  return {
    user: userEvent.setup(),
    textarea: screen.getByLabelText('Recovery Code'),
    submit: screen.getByRole('button', { name: 'Recover Account' }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sessionId = 'session-1';
  mocks.refreshSessionId.mockResolvedValue(undefined);
});

describe('RecoverAccountPage feedback', () => {
  it('shows a missing session as alert text and does not call the action', async () => {
    mocks.sessionId = null;
    const { user, textarea, submit } = renderPage();

    await user.type(textarea, 'some-code');
    await user.click(submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session ID is missing. Cannot recover account.'
    );
    expect(mocks.verifyCode).not.toHaveBeenCalled();
  });

  it('shows an invalid code as exactly one destructive alert', async () => {
    mocks.verifyCode.mockResolvedValue({ success: false, reason: 'invalid_code' });
    const { user, textarea, submit } = renderPage();

    await user.type(textarea, 'bad-code');
    await user.click(submit);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(INVALID_CODE_MESSAGE);
    expect(alert).toHaveClass('text-destructive');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('clears the alert as soon as the code is edited', async () => {
    mocks.verifyCode.mockResolvedValue({ success: false, reason: 'invalid_code' });
    const { user, textarea, submit } = renderPage();

    await user.type(textarea, 'bad-code');
    await user.click(submit);
    await screen.findByRole('alert');

    await user.type(textarea, 'x');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the alert on resubmit while verifying, then shows it again on failure', async () => {
    let resolveSecond!: (value: { success: boolean; reason?: string }) => void;
    mocks.verifyCode
      .mockResolvedValueOnce({ success: false, reason: 'invalid_code' })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
      );
    const { user, textarea, submit } = renderPage();

    await user.type(textarea, 'bad-code');
    await user.click(submit);
    await screen.findByRole('alert');

    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDisabled();

    resolveSecond({ success: false, reason: 'invalid_code' });
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_CODE_MESSAGE);
  });

  it('shows no alert after a successful recovery, and redirects to the app', async () => {
    mocks.verifyCode.mockResolvedValue({ success: true, user: { _id: 'user-1' } });
    const { user, textarea, submit } = renderPage();

    await user.type(textarea, 'good-code');
    await user.click(submit);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app'));
    expect(mocks.verifyCode).toHaveBeenCalledWith({
      recoveryCode: 'good-code',
      sessionId: 'session-1',
    });
    expect(mocks.refreshSessionId).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
