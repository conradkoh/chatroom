'use client';

import { featureFlags } from '@workspace/backend/config/featureFlags';
import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/UserMenu';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Main navigation header component with authentication state handling.
 * Shows login button for unauthenticated users and user menu for authenticated users.
 */
export function Navigation() {
  const authState = useAuthState();

  /**
   * Memoized authentication status to prevent unnecessary re-renders.
   */
  const authStatus = useMemo(() => {
    const isAuthenticated = authState?.state === 'authenticated';
    const isLoading = authState === undefined;
    return { isAuthenticated, isLoading };
  }, [authState]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center px-4 sm:px-6">
        <div className="mr-6 flex">
          <Link
            href={authStatus.isAuthenticated ? '/app' : '/'}
            className="flex items-center whitespace-nowrap"
          >
            <span className="font-bold text-lg">Chatroom</span>
          </Link>
        </div>
        <nav className="flex items-center justify-between w-full">
          <div className="flex gap-6 text-sm">{/* Navigation links removed */}</div>
          <div className="flex items-center gap-2">
            {_renderAuthSection(authStatus.isLoading, authStatus.isAuthenticated)}
          </div>
        </nav>
      </div>
    </header>
  );
}

/**
 * Renders the appropriate authentication section based on user state.
 */
function _renderAuthSection(isLoading: boolean, isAuthenticated: boolean) {
  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <UserMenu />;
  }

  if (!featureFlags.disableLogin) {
    return (
      <Link href="/login">
        <Button size="sm" variant="outline">
          Login
        </Button>
      </Link>
    );
  }

  return null;
}
