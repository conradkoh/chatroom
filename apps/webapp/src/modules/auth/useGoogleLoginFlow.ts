'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useQuery } from 'convex/react';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { buildGoogleOAuthUrl, createOAuthState, redirectToGoogleOAuth } from './google-oauth';

import { useGoogleAuthAvailable } from '@/modules/app/useAppInfo';

export function useGoogleLoginFlow(returnTo?: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const googleAuthAvailable = useGoogleAuthAvailable();
  const googleConfig = useQuery(api.auth.google.getConfig);
  const createLoginRequest = useSessionMutation(api.auth.google.createLoginRequest);

  // fallow-ignore-next-line complexity
  const startGoogleLogin = useCallback(async () => {
    if (!googleAuthAvailable || !googleConfig?.clientId) {
      toast.error('Google authentication is currently disabled or not configured');
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
      toast.error('Failed to start Google login. Please try again.');
      setIsLoading(false);
    }
  }, [googleAuthAvailable, googleConfig, createLoginRequest, returnTo]);

  return {
    startGoogleLogin,
    isLoading,
    isAvailable: !!googleAuthAvailable,
  };
}
