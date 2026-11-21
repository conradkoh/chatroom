'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useQuery } from 'convex/react';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { buildGoogleOAuthUrl, createOAuthState, redirectToGoogleOAuth } from './google-oauth';

import { useFeedback } from '@/hooks/useFeedback';
import { useGoogleAuthAvailable } from '@/modules/app/useAppInfo';

/**
 * Readiness of the Google login option.
 *
 * - `initializing`: app info and/or the OAuth config query have not resolved yet.
 *   Clicks must be silent no-ops (the button is disabled).
 * - `ready`: both resolved and Google is configured with a client ID.
 * - `unavailable`: Google is genuinely not configured (app info says disabled,
 *   or the config row is missing/disabled or has no client ID).
 */
export type GoogleLoginStatus = 'initializing' | 'ready' | 'unavailable';

type GoogleOAuthConfig = { enabled: boolean; clientId: string | null };

/**
 * Derives the Google login readiness from the two independent sources.
 *
 * Constraints:
 * - App info reporting `false` wins immediately: waiting on the config query
 *   cannot make Google available, so the state is `unavailable`, not `initializing`.
 * - Either source being unresolved otherwise keeps the state `initializing`.
 * - Only an enabled config with a client ID is `ready`.
 *
 * Covered end-to-end through `useGoogleLoginFlow` by GoogleLoginButton.test.tsx.
 */
// fallow-ignore-next-line complexity
function deriveGoogleLoginStatus(
  googleAuthAvailable: boolean | null,
  googleConfig: GoogleOAuthConfig | undefined
): GoogleLoginStatus {
  if (googleAuthAvailable === false) return 'unavailable';
  if (googleAuthAvailable === null || googleConfig === undefined) return 'initializing';
  return googleConfig.enabled && googleConfig.clientId ? 'ready' : 'unavailable';
}

export function useGoogleLoginFlow(returnTo?: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const { feedback: error, error: showError, clear: clearError } = useFeedback();
  const googleAuthAvailable = useGoogleAuthAvailable();
  const googleConfig = useQuery(api.auth.google.getConfig);
  const createLoginRequest = useSessionMutation(api.auth.google.createLoginRequest);

  const status = deriveGoogleLoginStatus(googleAuthAvailable, googleConfig);

  // fallow-ignore-next-line complexity
  const startGoogleLogin = useCallback(async () => {
    // While initializing the button is disabled; a click here must stay silent
    // so the user never sees a misleading "not configured" message.
    if (status === 'initializing') return;

    // Every attempt starts from a clean slate: the previous failure leaves the row.
    clearError();

    if (status === 'unavailable' || !googleConfig?.clientId) {
      showError('Google authentication is currently disabled or not configured');
      return;
    }

    setIsLoading(true);
    try {
      const redirectUri = `${window.location.origin}/api/auth/google/callback`;
      const result = await createLoginRequest({ redirectUri });

      const returnPath = returnTo || '/app';
      const state = createOAuthState('login', result.loginId, returnPath);
      const authUrl = buildGoogleOAuthUrl({
        clientId: googleConfig.clientId,
        redirectUri,
        state,
      });

      redirectToGoogleOAuth(authUrl);
    } catch {
      showError('Failed to start Google login. Please try again.');
      setIsLoading(false);
    }
  }, [status, googleConfig, createLoginRequest, returnTo, clearError, showError]);

  return {
    startGoogleLogin,
    isLoading,
    status,
    error,
    clearError,
  };
}
