import { describe, expect, it, vi } from 'vitest';

import { createOAuthState, getOAuthCallbackReturnTo, redirectToGoogleOAuth } from './google-oauth';

describe('redirectToGoogleOAuth', () => {
  it('assigns window.location to auth URL', () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });

    redirectToGoogleOAuth('https://accounts.google.com/o/oauth2/auth?...');
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?...');
  });
});

describe('createOAuthState', () => {
  it('includes returnTo when provided', () => {
    const state = createOAuthState('login', 'req-123', '/app');
    const parsed = JSON.parse(decodeURIComponent(state));
    expect(parsed).toEqual({
      flowType: 'login',
      requestId: 'req-123',
      version: 'v1',
      returnTo: '/app',
    });
  });

  it('omits returnTo when not provided', () => {
    const state = createOAuthState('connect', 'req-456');
    const parsed = JSON.parse(decodeURIComponent(state));
    expect(parsed).toEqual({
      flowType: 'connect',
      requestId: 'req-456',
      version: 'v1',
    });
  });
});

describe('getOAuthCallbackReturnTo', () => {
  it('returns returnTo from state when present', () => {
    const state = createOAuthState('login', 'req-123', '/app/dashboard');
    expect(getOAuthCallbackReturnTo(state)).toBe('/app/dashboard');
  });

  it('defaults to /login for login flow without returnTo', () => {
    const state = createOAuthState('login', 'req-123');
    expect(getOAuthCallbackReturnTo(state)).toBe('/login');
  });

  it('defaults to /app/profile for connect flow without returnTo', () => {
    const state = createOAuthState('connect', 'req-123');
    expect(getOAuthCallbackReturnTo(state)).toBe('/app/profile');
  });

  it('returns /login for invalid state', () => {
    expect(getOAuthCallbackReturnTo('not-valid-json')).toBe('/login');
  });
});
