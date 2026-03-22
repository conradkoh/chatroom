'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuthState } from '@/modules/auth/AuthProvider';

type CodeAction =
  | { type: 'SET_CODE'; code: string; expiresAt: number }
  | { type: 'CLEAR_CODE' }
  | { type: 'SET_EXPIRED' }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'SET_COPIED'; value: boolean };

interface CodeState {
  loginCode: string | null;
  expiresAt: number | null;
  isExpired: boolean;
  isGenerating: boolean;
  isCopied: boolean;
}

function codeReducer(state: CodeState, action: CodeAction): CodeState {
  switch (action.type) {
    case 'SET_CODE':
      return { ...state, loginCode: action.code, expiresAt: action.expiresAt, isExpired: false };
    case 'CLEAR_CODE':
      return { ...state, loginCode: null, expiresAt: null, isExpired: false, isCopied: false };
    case 'SET_EXPIRED':
      return { ...state, isExpired: true };
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.value };
    case 'SET_COPIED':
      return { ...state, isCopied: action.value };
  }
}

/**
 * Displays login code generator for authenticated users to access their account on other devices.
 */
export function LoginCodeGenerator() {
  const authState = useAuthState();
  const createLoginCode = useSessionMutation(api.auth.createLoginCode);
  const activeCodeQuery = useSessionQuery(api.auth.getActiveLoginCode);

  const [state, dispatch] = useReducer(codeReducer, {
    loginCode: null,
    expiresAt: null,
    isExpired: false,
    isGenerating: false,
    isCopied: false,
  });

  const { loginCode, expiresAt, isExpired, isGenerating, isCopied } = state;

  const getTimeRemaining = useCallback(() => _getTimeRemaining(expiresAt), [expiresAt]);
  const [, forceUpdate] = useState(0);
  const timeRemaining = _getTimeRemaining(expiresAt);

  const isAuthenticatedUser = useMemo(() => {
    return authState?.state === 'authenticated' && 'user' in authState;
  }, [authState]);

  const buttonText = useMemo(() => {
    if (isGenerating) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Generating...</span>
        </>
      );
    }
    return loginCode ? 'Generate New Code' : 'Generate Login Code';
  }, [isGenerating, loginCode]);

  // Sync code from backend query during render
  const [prevActiveCodeQuery, setPrevActiveCodeQuery] = useState(activeCodeQuery);
  if (prevActiveCodeQuery !== activeCodeQuery) {
    setPrevActiveCodeQuery(activeCodeQuery);
    if (activeCodeQuery) {
      if (activeCodeQuery.success && activeCodeQuery.code && activeCodeQuery.expiresAt) {
        if (loginCode !== activeCodeQuery.code) {
          dispatch({
            type: 'SET_CODE',
            code: activeCodeQuery.code,
            expiresAt: activeCodeQuery.expiresAt,
          });
        }
      } else if (loginCode) {
        if (activeCodeQuery.reason === 'no_active_code' && !isExpired) {
          toast.info('Your login code was used successfully');
        }
        dispatch({ type: 'CLEAR_CODE' });
      }
    }
  }

  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      forceUpdate((n) => n + 1);
      if (_getTimeRemaining(expiresAt) === '0:00' && !isExpired) {
        dispatch({ type: 'SET_EXPIRED' });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, isExpired]);

  const handleGenerateCode = useCallback(async () => {
    await _handleGenerateCode({
      authState,
      isGenerating,
      dispatch,
      createLoginCode,
      getTimeRemaining,
    });
  }, [authState, isGenerating, createLoginCode, getTimeRemaining]);

  const handleCopyCode = useCallback(async () => {
    if (!loginCode) return;

    try {
      await navigator.clipboard.writeText(loginCode);
      dispatch({ type: 'SET_COPIED', value: true });
      toast.success('Code copied to clipboard');

      setTimeout(() => {
        dispatch({ type: 'SET_COPIED', value: false });
      }, 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
      toast.error('Failed to copy code to clipboard');
    }
  }, [loginCode]);

  const handleClearCode = useCallback(() => {
    dispatch({ type: 'CLEAR_CODE' });
  }, []);

  // Early return if not an authenticated user
  if (!isAuthenticatedUser) {
    return null;
  }

  return (
    <div className="w-full border rounded-lg overflow-hidden">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold">Use Your Account on Another Device</h3>
        <p className="text-sm text-muted-foreground">
          Generate a temporary login code to access your account from another device
        </p>
      </div>

      <div className="p-6">
        {loginCode ? (
          <div className="space-y-4">
            {isExpired ? (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg text-center relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClearCode}
                    aria-label="Clear login code"
                    className="absolute top-2 right-2 h-6 w-6"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <p className="text-sm text-muted-foreground mb-1">Your login code:</p>
                  <p
                    className="text-3xl font-mono font-bold tracking-wider text-muted-foreground/40"
                    aria-live="polite"
                  >
                    {formatLoginCode(loginCode)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">Expired</p>
                </div>
                <div className="flex flex-col items-center gap-2 text-center">
                  <p className="text-sm text-muted-foreground">This code is no longer valid</p>
                  <Button onClick={handleGenerateCode} disabled={isGenerating} size="sm">
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Generate New Code
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 bg-secondary/50 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-1">Your login code:</p>
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-3xl font-mono font-bold tracking-wider" aria-live="polite">
                      {formatLoginCode(loginCode)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopyCode}
                      aria-label="Copy login code to clipboard"
                      className="h-9 w-9"
                    >
                      {isCopied ? (
                        <Check
                          className="h-5 w-5 text-green-600 dark:text-green-400"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy className="h-5 w-5" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2" aria-live="polite">
                    Valid for {timeRemaining}
                  </p>
                </div>

                <div className="text-sm text-muted-foreground">
                  <p>
                    Enter this code on the login page of your other device to access your account.
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm space-y-2">
            <p>
              Generate a temporary login code that allows you to access your account from another
              device. The code will be valid for 1 minute.
            </p>
            <p>
              <strong>Note:</strong> This will invalidate any previously generated codes.
            </p>
          </div>
        )}
      </div>

      {!isExpired && (
        <div className="p-4 bg-secondary/50 border-t flex justify-end">
          <Button
            onClick={handleGenerateCode}
            disabled={isGenerating}
            aria-busy={isGenerating}
            aria-label={loginCode ? 'Generate a new login code' : 'Generate a login code'}
          >
            {buttonText}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Calculates time remaining until code expiration in MM:SS format.
 */
function _getTimeRemaining(expiresAt: number | null): string {
  if (!expiresAt) return '';

  const timeLeft = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(timeLeft / (1000 * 60));
  const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface _HandleGenerateCodeParams {
  authState: ReturnType<typeof useAuthState>;
  isGenerating: boolean;
  dispatch: React.Dispatch<CodeAction>;
  createLoginCode: () => Promise<{ success: boolean; code?: string; expiresAt?: number }>;
  getTimeRemaining: () => string;
}

/**
 * Handles login code generation with authentication validation and error handling.
 */
async function _handleGenerateCode(params: _HandleGenerateCodeParams): Promise<void> {
  const { authState, isGenerating, dispatch, createLoginCode } = params;

  if (authState?.state !== 'authenticated') {
    toast.error('You must be logged in to generate a login code');
    return;
  }

  if (isGenerating) return;

  dispatch({ type: 'SET_GENERATING', value: true });
  try {
    const result = await createLoginCode();
    if (result.success && result.code && result.expiresAt) {
      dispatch({ type: 'SET_CODE', code: result.code, expiresAt: result.expiresAt });
      toast.success('Login code generated successfully');
    } else {
      toast.error('Failed to generate login code');
    }
  } catch (error) {
    console.error('Error generating login code:', error);
    toast.error('An error occurred while generating login code');
  } finally {
    dispatch({ type: 'SET_GENERATING', value: false });
  }
}
