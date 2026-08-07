'use client';

import { ChevronRight } from 'lucide-react';

import { GoogleIcon } from './GoogleIcon';
import { useGoogleLoginFlow } from './useGoogleLoginFlow';

import { Button } from '@/components/ui/button';

export interface GoogleLoginButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  showChevron?: boolean;
  returnTo?: string | null;
}

/**
 * Google login button component with OAuth integration.
 * Uses inline popup OAuth flow with backend-driven login requests.
 */
export const GoogleLoginButton = ({
  className = 'w-full',
  variant = 'outline',
  showChevron = false,
  returnTo,
}: GoogleLoginButtonProps) => {
  const { startGoogleLogin, isLoading, isAvailable } = useGoogleLoginFlow(returnTo);

  if (variant === 'ghost' && showChevron) {
    return (
      <button
        type="button"
        className="flex items-center justify-between w-full h-16 px-6 hover:bg-muted/50 transition-colors cursor-pointer group border-0 bg-transparent text-left disabled:cursor-not-allowed disabled:opacity-50"
        onClick={startGoogleLogin}
        disabled={isLoading || !isAvailable}
        aria-label="Sign in with Google"
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
              Sign in with your Google account
            </span>
          </div>
        </div>
        {isLoading ? (
          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        )}
      </button>
    );
  }

  return (
    <Button
      variant={variant}
      onClick={startGoogleLogin}
      disabled={isLoading || !isAvailable}
      className={className}
    >
      {isLoading ? (
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
  );
};
