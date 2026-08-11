'use client';

import { CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface CallbackSuccessCardProps {
  flowType?: 'login' | 'connect';
  autoCloseDelay?: number;
  onClose?: () => void;
  redirectTo?: string;
  userName?: string;
}

/**
 * Displays OAuth callback success with automatic redirect and countdown timer.
 */
export function CallbackSuccessCard({
  flowType = 'login',
  autoCloseDelay = 3,
  onClose,
  redirectTo,
  userName,
}: CallbackSuccessCardProps) {
  const [countdown, setCountdown] = useState(autoCloseDelay);
  const destination = redirectTo ?? '/login';

  useEffect(() => {
    if (countdown <= 0) {
      const timer = setTimeout(() => {
        if (onClose) {
          onClose();
        } else {
          window.location.assign(destination);
        }
      }, 500);

      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onClose, destination]);

  const successMessage = _getSuccessMessage(flowType, userName);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center space-y-3">
        <CheckCircle className="mx-auto h-10 w-10 text-green-600" />
        <p className="text-sm font-medium">{successMessage}</p>
        <p className="text-xs text-muted-foreground">Redirecting in {countdown}s…</p>
      </div>
    </div>
  );
}

function _getSuccessMessage(flowType: 'login' | 'connect', userName?: string): string {
  if (flowType === 'connect') {
    return userName
      ? `Google account connected successfully for ${userName}!`
      : 'Google account connected successfully!';
  }

  return userName ? `Welcome back, ${userName}!` : 'Sign in successful!';
}
