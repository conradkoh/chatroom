'use client';

import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getGoogleOAuthUserFriendlyError } from '@/modules/auth/google-oauth-errors';

export interface CallbackErrorCardProps {
  error: string;
  flowType?: 'login' | 'connect';
  onRetry?: () => void;
  onClose?: () => void;
  redirectTo?: string;
}

/**
 * Displays OAuth callback errors with user-friendly messaging and go-back button.
 */
export function CallbackErrorCard({
  error,
  flowType = 'login',
  onClose,
  redirectTo,
}: CallbackErrorCardProps) {
  const userFriendlyError = getGoogleOAuthUserFriendlyError(error, flowType);
  const title = flowType === 'connect' ? 'Connection Failed' : 'Sign In Failed';
  const destination = redirectTo ?? '/login';

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      window.location.assign(destination);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-sm">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="text-sm text-muted-foreground">{userFriendlyError}</p>
        <Button variant="outline" onClick={handleClose} className="w-full">
          Go Back
        </Button>
      </div>
    </div>
  );
}
