'use client';

import { ChevronRight } from 'lucide-react';

import { GoogleIcon } from './GoogleIcon';
import { useGoogleLoginFlow } from './useGoogleLoginFlow';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';

export interface GoogleLoginButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  showChevron?: boolean;
  returnTo?: string | null;
  /**
   * Render nothing instead of a disabled "unavailable" affordance.
   * Use on screens where a permanently disabled Google option is just noise.
   */
  hideWhenUnavailable?: boolean;
}

/**
 * Google login button component with OAuth integration.
 * Uses full-page redirect OAuth flow.
 *
 * The button owns its readiness presentation: it stays visible but disabled and
 * labelled "Initializing…" until both app info and the OAuth config resolve, so
 * a click can never produce the "not configured" message mid-initialization.
 * A failed start is shown as text directly under the control.
 */
// fallow-ignore-next-line complexity
export const GoogleLoginButton = ({
  className = 'w-full',
  variant = 'outline',
  showChevron = false,
  returnTo,
  hideWhenUnavailable = false,
}: GoogleLoginButtonProps) => {
  const { startGoogleLogin, isLoading, status, error } = useGoogleLoginFlow(returnTo);

  const isInitializing = status === 'initializing';
  const isUnavailable = status === 'unavailable';
  const isDisabled = isLoading || status !== 'ready';

  if (isUnavailable && hideWhenUnavailable) {
    return null;
  }

  const isRow = variant === 'ghost' && showChevron;

  // The failure line sits directly under the control, inside the same wrapper, so the
  // parent's divider falls between rows and never between a control and its message.
  const errorLine = (
    <InlineFeedback variant="text" feedback={error} className={isRow ? 'px-6 pb-3' : 'pt-2'} />
  );

  if (isRow) {
    return (
      <div>
        <button
          type="button"
          className="flex items-center justify-between w-full h-16 px-6 hover:bg-muted/50 transition-colors cursor-pointer group border-0 bg-transparent text-left disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          onClick={startGoogleLogin}
          disabled={isDisabled}
          aria-label="Sign in with Google"
          aria-busy={isInitializing ? true : undefined}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-8 h-8">
              <GoogleIcon className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-left">
                {isLoading ? 'Connecting to Google...' : 'Continue with Google'}
              </span>
              <span className="text-sm text-muted-foreground text-left">
                {isInitializing
                  ? 'Initializing…'
                  : isUnavailable
                    ? 'Google sign-in is unavailable'
                    : 'Sign in with your Google account'}
              </span>
            </div>
          </div>
          {isLoading || isInitializing ? (
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>
        {errorLine}
      </div>
    );
  }

  return (
    <div>
      <Button
        variant={variant}
        onClick={startGoogleLogin}
        disabled={isDisabled}
        aria-busy={isInitializing ? true : undefined}
        className={className}
      >
        {isInitializing ? (
          <>
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Initializing Google sign-in…
          </>
        ) : isUnavailable ? (
          <>
            <GoogleIcon className="mr-2 h-4 w-4" />
            Google sign-in unavailable
          </>
        ) : isLoading ? (
          <>
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Connecting to Google...
          </>
        ) : (
          <>
            <GoogleIcon className="mr-2 h-4 w-4" />
            Continue with Google
          </>
        )}
      </Button>
      {errorLine}
    </div>
  );
};
