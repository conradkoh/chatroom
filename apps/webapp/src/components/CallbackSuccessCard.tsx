'use client';

import { CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface CallbackSuccessCardProps {
  flowType?: 'login' | 'connect';
  autoCloseDelay?: number;
  onClose?: () => void;
  userName?: string;
}

/**
 * Displays OAuth callback success with automatic window closure and countdown timer.
 */
export function CallbackSuccessCard({
  flowType = 'login',
  autoCloseDelay = 3,
  onClose,
  userName,
}: CallbackSuccessCardProps) {
  const [countdown, setCountdown] = useState(autoCloseDelay);

  useEffect(() => {
    if (countdown <= 0) {
      const timer = setTimeout(() => {
        if (onClose) {
          onClose();
        } else {
          window.close();
        }
      }, 500);

      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onClose]);

  const successMessage = _getSuccessMessage(flowType, userName);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center space-y-3">
        <CheckCircle className="mx-auto h-10 w-10 text-green-600" />
        <p className="text-sm font-medium">{successMessage}</p>
        <p className="text-xs text-muted-foreground">Closing in {countdown}s…</p>
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
