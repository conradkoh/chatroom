import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './page';

const harness = vi.hoisted(() => ({
  featureFlags: { disableLogin: false },
  authState: { state: 'unauthenticated' } as { state: string },
  search: new URLSearchParams(),
  push: vi.fn(),
}));

vi.mock('@workspace/backend/config/featureFlags', () => ({
  featureFlags: harness.featureFlags,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push }),
  useSearchParams: () => harness.search,
}));

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => harness.authState,
}));

vi.mock('@/modules/app/useAppInfo', () => ({
  useSignupConfig: () => null,
}));

vi.mock('@/modules/auth/GoogleLoginButton', () => ({
  GoogleLoginButton: () => null,
}));

vi.mock('@/modules/auth/AnonymousLoginButton', () => ({
  AnonymousLoginButton: () => null,
}));

/** Sets the browser URL, then mirrors its query into the mocked useSearchParams. */
function setUrl(path: string) {
  window.history.replaceState({}, '', path);
  harness.search = new URLSearchParams(window.location.search);
}

describe('LoginPage ?error= alert', () => {
  beforeEach(() => {
    harness.featureFlags.disableLogin = false;
    harness.authState = { state: 'unauthenticated' };
    harness.push.mockClear();
    setUrl('/login');
  });

  it('keeps the alert visible when login is disabled', () => {
    harness.featureFlags.disableLogin = true;
    setUrl('/login?error=Access%20denied');

    render(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Login Disabled' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(window.location.search).toBe('');
  });

  it('keeps the alert visible while an authenticated visitor is redirected', () => {
    harness.authState = { state: 'authenticated' };
    setUrl('/login?error=Access%20denied');

    render(<LoginPage />);

    expect(harness.push).toHaveBeenCalledWith('/app');
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
});
