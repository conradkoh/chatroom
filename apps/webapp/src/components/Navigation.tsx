'use client';

import { featureFlags } from '@workspace/backend/config/featureFlags';
import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/UserMenu';
import { useAuthState } from '@/modules/auth/AuthProvider';
import { useHeaderPortal } from '@/modules/header/HeaderPortalProvider';

/**
 * Main navigation header component with authentication state handling.
 * Implements Industrial Design System styling with portal support.
 */
export function Navigation() {
  const authState = useAuthState();
  const portalContent = useHeaderPortal();

  /**
   * Memoized authentication status to prevent unnecessary re-renders.
   */
  const authStatus = useMemo(() => {
    const isAuthenticated = authState?.state === 'authenticated';
    const isLoading = authState === undefined;
    return { isAuthenticated, isLoading };
  }, [authState]);

  return (
    <header className="sticky top-0 z-50 w-full border-b-2 border-border/15 bg-zinc-950/95 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/80">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Left section: Logo and portal content */}
        <div className="flex items-center gap-4">
          <Link
            href={authStatus.isAuthenticated ? '/app' : '/'}
            className="flex items-center whitespace-nowrap"
          >
            <span className="text-sm font-bold uppercase tracking-widest text-zinc-100">
              Chatroom
            </span>
          </Link>
          {/* Portal content injection point */}
          {portalContent.left}
        </div>

        {/* Center section: Portal content */}
        {portalContent.center && (
          <div className="hidden sm:flex items-center">{portalContent.center}</div>
        )}

        {/* Right section: Portal content and auth */}
        <div className="flex items-center gap-3">
          {portalContent.right}
          {_renderAuthSection(authStatus.isLoading, authStatus.isAuthenticated)}
        </div>
      </div>
    </header>
  );
}

/**
 * Renders the appropriate authentication section based on user state.
 * Uses Industrial Design System styling.
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
        <Button
          size="sm"
          variant="outline"
          className="border-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-xs font-bold uppercase tracking-wide"
        >
          Login
        </Button>
      </Link>
    );
  }

  return null;
}
