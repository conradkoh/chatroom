import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginWithCode } from './LoginWithCode';

/**
 * Boundary mocks only: the Convex session mutation and the Next router.
 * The component under test is exercised for real.
 */
const mocks = vi.hoisted(() => ({
  verifyLoginCode: vi.fn(),
  push: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.verifyLoginCode,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe('LoginWithCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function submitCode(code: string) {
    await userEvent.type(screen.getByLabelText('Enter login code'), code);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('shows a rejected code once as visible alert text and does not redirect', async () => {
    mocks.verifyLoginCode.mockResolvedValueOnce({ success: false, message: 'Code expired.' });

    render(<LoginWithCode />);
    await submitCode('abcd1234');

    expect(mocks.verifyLoginCode).toHaveBeenCalledWith({ code: 'ABCD1234' });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Code expired.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows a failed verification request as alert text and does not redirect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.verifyLoginCode.mockRejectedValueOnce(new Error('boom'));

    render(<LoginWithCode />);
    await submitCode('abcd1234');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to verify code. Please try again.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('redirects on success and shows no message', async () => {
    mocks.verifyLoginCode.mockResolvedValueOnce({ success: true, message: 'ok' });

    render(<LoginWithCode />);
    await submitCode('abcd1234');

    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
