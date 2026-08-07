'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  buildGoogleOAuthUrl,
  createOAuthState,
  GOOGLE_OAUTH_POPUP_FEATURES,
  GOOGLE_OAUTH_POPUP_TIMEOUT_MS,
} from './google-oauth';

import { useGoogleAuthAvailable } from '@/modules/app/useAppInfo';

export function useGoogleLoginFlow(returnTo?: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [loginRequestId, setLoginRequestId] = useState<Id<'auth_loginRequests'> | null>(null);
  const router = useRouter();
  const googleAuthAvailable = useGoogleAuthAvailable();
  const googleConfig = useQuery(api.auth.google.getConfig);
  const createLoginRequest = useSessionMutation(api.auth.google.createLoginRequest);

  const popupPollRef = useRef<NodeJS.Timeout | null>(null);
  const popupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loginStatusRef = useRef<string | undefined>(undefined);

  const loginRequest = useQuery(
    api.auth.google.getLoginRequest,
    loginRequestId ? { loginRequestId } : 'skip'
  );

  loginStatusRef.current = loginRequest?.status;

  const cleanupTimers = useCallback(() => {
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    if (popupTimeoutRef.current) {
      clearTimeout(popupTimeoutRef.current);
      popupTimeoutRef.current = null;
    }
  }, []);

  // React to terminal login request status
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!loginRequest || !isLoading) return;

    if (loginRequest.status === 'completed') {
      cleanupTimers();
      setIsLoading(false);
      setLoginRequestId(null);
      toast.success('Login successful!');
      router.push(returnTo || '/app');
    } else if (loginRequest.status === 'failed') {
      cleanupTimers();
      setIsLoading(false);
      setLoginRequestId(null);
      toast.error(loginRequest.error || 'Login failed');
    }
  }, [loginRequest, isLoading, router, returnTo, cleanupTimers]);

  useEffect(() => {
    return () => cleanupTimers();
  }, [cleanupTimers]);

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
      setLoginRequestId(result.loginId);

      const state = createOAuthState('login', result.loginId);
      const authUrl = buildGoogleOAuthUrl({
        clientId: googleConfig.clientId,
        redirectUri,
        state,
      });

      const popup = window.open(authUrl, 'google-oauth', GOOGLE_OAUTH_POPUP_FEATURES);
      if (!popup) {
        toast.error('Failed to open popup. Please enable popups and try again.');
        setIsLoading(false);
        setLoginRequestId(null);
        return;
      }

      popupPollRef.current = setInterval(() => {
        if (popup.closed) {
          if (popupPollRef.current) {
            clearInterval(popupPollRef.current);
            popupPollRef.current = null;
          }
          if (loginStatusRef.current === 'pending') {
            setIsLoading(false);
            setLoginRequestId(null);
          }
        }
      }, 1000);

      popupTimeoutRef.current = setTimeout(() => {
        cleanupTimers();
        if (!popup.closed) popup.close();
        toast.error('Login timeout. Please try again.');
        setIsLoading(false);
        setLoginRequestId(null);
      }, GOOGLE_OAUTH_POPUP_TIMEOUT_MS);
    } catch {
      toast.error('Failed to start Google login. Please try again.');
      setIsLoading(false);
      setLoginRequestId(null);
    }
  }, [googleAuthAvailable, googleConfig, createLoginRequest, cleanupTimers]);

  return {
    startGoogleLogin,
    isLoading,
    isAvailable: !!googleAuthAvailable,
  };
}
