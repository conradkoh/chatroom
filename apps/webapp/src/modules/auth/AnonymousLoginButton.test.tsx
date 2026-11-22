import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnonymousLoginButton } from './AnonymousLoginButton';

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

describe('AnonymousLoginButton', () => {
  beforeEach(() => {
    mocks.loginAnon.mockReset();
    mocks.push.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the failure inline in the list variant and does not navigate', async () => {
    mocks.loginAnon.mockRejectedValueOnce(new Error('offline'));
    render(<AnonymousLoginButton variant="list" />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Continue anonymously without creating an account' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to login. Please try again later.'
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows the failure inline in the button variant', async () => {
    mocks.loginAnon.mockRejectedValueOnce(new Error('offline'));
    render(<AnonymousLoginButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Login Anonymously' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to login. Please try again later.'
    );
  });

  it('navigates to /app on success and shows no message', async () => {
    mocks.loginAnon.mockResolvedValueOnce(undefined);
    render(<AnonymousLoginButton variant="list" />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Continue anonymously without creating an account' })
    );

    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the failure when the next attempt starts', async () => {
    mocks.loginAnon.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<AnonymousLoginButton variant="list" />);
    const button = screen.getByRole('button', {
      name: 'Continue anonymously without creating an account',
    });

    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.push).toHaveBeenCalledWith('/app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
