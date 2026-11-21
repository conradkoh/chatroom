import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GoogleOAuthModule from './google-oauth';
import { GoogleLoginButton } from './GoogleLoginButton';

/**
 * Boundary mocks only: the app-info availability hook, the Convex config query,
 * the session mutation used to create a login request, and the OAuth redirect.
 * The hook under test (`useGoogleLoginFlow`) and the component are exercised
 * for real.
 */
const mocks = vi.hoisted(() => ({
  useGoogleAuthAvailable: vi.fn(),
  useQuery: vi.fn(),
  createLoginRequest: vi.fn(),
  redirectToGoogleOAuth: vi.fn(),
}));

vi.mock('@/modules/app/useAppInfo', () => ({
  useGoogleAuthAvailable: mocks.useGoogleAuthAvailable,
}));

vi.mock('convex/react', () => ({
  useQuery: mocks.useQuery,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.createLoginRequest,
}));

vi.mock('./google-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof GoogleOAuthModule>();
  return { ...actual, redirectToGoogleOAuth: mocks.redirectToGoogleOAuth };
});

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLoginRequest.mockResolvedValue({ loginId: 'l1' });
  });

  it('shows a disabled initializing row and ignores clicks while the Google config is pending', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue(undefined);

    render(<GoogleLoginButton variant="ghost" showChevron={true} returnTo="/app" />);

    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
    expect(screen.getByText('Initializing…')).toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.createLoginRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a disabled initializing row and ignores clicks while app info is pending', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(null);
    mocks.useQuery.mockReturnValue(undefined);

    render(<GoogleLoginButton variant="ghost" showChevron={true} />);

    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Initializing…')).toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.createLoginRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts the Google flow on a single click once app info and config are both ready', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue(undefined);

    const { rerender } = render(
      <GoogleLoginButton variant="ghost" showChevron={true} returnTo="/app" />
    );
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();

    mocks.useQuery.mockReturnValue({ enabled: true, clientId: 'test-client-id' });
    rerender(<GoogleLoginButton variant="ghost" showChevron={true} returnTo="/app" />);

    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(button).toBeEnabled();
    expect(screen.getByText('Sign in with your Google account')).toBeInTheDocument();
    expect(screen.queryByText('Initializing…')).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.createLoginRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createLoginRequest).toHaveBeenCalledWith({
      redirectUri: 'http://localhost:3000/api/auth/google/callback',
    });
    expect(mocks.redirectToGoogleOAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed Google login start as text under the row and clears it on the next attempt', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue({ enabled: true, clientId: 'test-client-id' });
    mocks.createLoginRequest.mockRejectedValueOnce(new Error('network down'));

    render(<GoogleLoginButton variant="ghost" showChevron={true} returnTo="/app" />);

    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    await userEvent.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to start Google login. Please try again.');
    expect(alert.parentElement).toContainElement(button);
    expect(mocks.redirectToGoogleOAuth).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(mocks.createLoginRequest).toHaveBeenCalledTimes(2);
    expect(mocks.redirectToGoogleOAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the outline variant with an explicit initializing label', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue(undefined);

    render(<GoogleLoginButton />);

    const button = screen.getByRole('button', { name: 'Initializing Google sign-in…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.createLoginRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows Google sign-in as unavailable (not initializing) when the config is resolved but disabled', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue({ enabled: false, clientId: null });

    render(<GoogleLoginButton variant="ghost" showChevron={true} />);

    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Google sign-in is unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/initializing/i)).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(mocks.createLoginRequest).not.toHaveBeenCalled();
  });

  it('treats app info reporting Google as disabled as unavailable even while the config is pending', () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(false);
    mocks.useQuery.mockReturnValue(undefined);

    render(<GoogleLoginButton />);

    const button = screen.getByRole('button', { name: /unavailable/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Google sign-in unavailable');
    expect(screen.queryByText(/initializing/i)).not.toBeInTheDocument();
  });

  it('renders nothing when unavailable and hideWhenUnavailable is set', () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue({ enabled: false, clientId: null });

    const { container } = render(
      <GoogleLoginButton variant="ghost" showChevron={true} hideWhenUnavailable />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the start failure inline and clears it on the next click', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue({ enabled: true, clientId: 'test-client-id' });
    mocks.createLoginRequest.mockRejectedValueOnce(new Error('network down'));

    render(<GoogleLoginButton variant="ghost" showChevron={true} returnTo="/app" />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to start Google login. Please try again.'
    );
    expect(mocks.redirectToGoogleOAuth).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(mocks.redirectToGoogleOAuth).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the start failure inline in the outline variant too', async () => {
    mocks.useGoogleAuthAvailable.mockReturnValue(true);
    mocks.useQuery.mockReturnValue({ enabled: true, clientId: 'test-client-id' });
    mocks.createLoginRequest.mockRejectedValueOnce(new Error('network down'));

    render(<GoogleLoginButton />);

    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to start Google login. Please try again.'
    );
  });
});
