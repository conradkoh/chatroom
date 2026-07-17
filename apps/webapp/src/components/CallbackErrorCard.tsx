// 1. Imports (external first, then internal)
'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getGoogleOAuthUserFriendlyError } from '@/modules/auth/google-oauth-errors';

// 2. Public interfaces and types
export interface CallbackErrorCardProps {
  error: string;
  flowType?: 'login' | 'connect';
  onRetry?: () => void;
  onClose?: () => void;
}

// 3. Internal interfaces and types (prefixed with _)
// None needed for this file

// 4. Main exported functions/components
/**
 * Displays OAuth callback errors with user-friendly messaging and appropriate action buttons.
 */
export function CallbackErrorCard({
  error,
  flowType = 'login',
  onRetry,
  onClose,
}: CallbackErrorCardProps) {
  const userFriendlyError = getGoogleOAuthUserFriendlyError(error, flowType);
  const title = flowType === 'connect' ? 'Connection Failed' : 'Sign In Failed';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <Card className="border-destructive/20">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-destructive">{title}</CardTitle>
            <CardDescription className="text-muted-foreground">{userFriendlyError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Technical error details - only show in development */}
            {process.env.NODE_ENV === 'development' && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  Technical Details
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words bg-muted p-2 rounded">
                  {error}
                </pre>
              </details>
            )}

            <div className="flex flex-col gap-2">
              {onRetry && (
                <Button onClick={onRetry} className="w-full">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
              )}

              {onClose ? (
                <Button variant="outline" onClick={onClose} className="w-full">
                  Close Window
                </Button>
              ) : (
                <Button variant="outline" onClick={() => window.close()} className="w-full">
                  Close Window
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Additional help text */}
        <div className="text-center text-sm text-muted-foreground">
          {flowType === 'connect' ? (
            <p>
              Having trouble connecting your account?{' '}
              <Button
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => window.open('/help/account-connection', '_blank')}
              >
                Get help
              </Button>
            </p>
          ) : (
            <p>
              Need help signing in?{' '}
              <Button
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => window.open('/help/sign-in', '_blank')}
              >
                Get help
              </Button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// 5. Internal helper functions (at bottom)
// None needed — using getGoogleOAuthUserFriendlyError from shared module
