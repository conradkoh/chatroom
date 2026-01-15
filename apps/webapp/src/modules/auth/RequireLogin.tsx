'use client';

import { useMemo } from 'react';

import { PageSpinner } from '@/components/ui/spinner';
import { UnauthorizedPage } from '@/components/UnauthorizedPage';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Authentication guard component that requires user login to access protected content.
 * Shows loading state while checking authentication and unauthorized page for unauthenticated users.
 */
export const RequireLogin = ({ children }: { children: React.ReactNode }) => {
  const authState = useAuthState();

  const authStatus = useMemo(() => {
    if (!authState) return 'loading';
    if (authState.state === 'unauthenticated') return 'unauthorized';
    return 'authenticated';
  }, [authState]);

  if (authStatus === 'loading') {
    return <PageSpinner />;
  }

  if (authStatus === 'unauthorized') {
    return <UnauthorizedPage />;
  }

  return <>{children}</>;
};
