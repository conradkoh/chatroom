import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnonymousLoginButton } from './AnonymousLoginButton';

/**
 * Boundary mocks only: the Convex session mutation and the Next router.
 * The component under test is exercised for real.
 */
const mocks = vi.hoisted(() => ({
  loginAnon: vi.fn(),
  push: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.loginAnon,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const ROW_NAME = 'Continue anonymously without creating an account';

describe('AnonymousLoginButton (list variant)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a failed anonymous login as text under its row and does not redirect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loginAnon.mockRejectedValueOnce(new Error('boom'));

    render(<AnonymousLoginButton variant="list" />);

    const row = screen.getByRole('button', { name: ROW_NAME });
    await userEvent.click(row);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to login. Please try again later.');
    expect(alert.parentElement).toContainElement(row);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('clears the failure at the next attempt and redirects on success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loginAnon.mockRejectedValueOnce(new Error('boom'));

    render(<AnonymousLoginButton variant="list" />);

    await userEvent.click(screen.getByRole('button', { name: ROW_NAME }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: ROW_NAME }));

    expect(mocks.loginAnon).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no message on success; the redirect is the outcome', async () => {
    mocks.loginAnon.mockResolvedValueOnce(undefined);

    render(<AnonymousLoginButton variant="list" />);

    await userEvent.click(screen.getByRole('button', { name: ROW_NAME }));

    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
