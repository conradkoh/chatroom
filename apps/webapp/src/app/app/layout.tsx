'use client';

import { Suspense } from 'react';

import { PageSpinner } from '@/components/ui/spinner';
import { AuthErrorBoundary } from '@/modules/auth/AuthErrorBoundary';
import { RequireLogin } from '@/modules/auth/RequireLogin';
import { ChatroomSwitcher } from '@/modules/chatroom/components/ChatroomSwitcher';

/**
 * Authenticated application layout.
 *
 * This layout provides a layered authentication system:
 * 1. RequireLogin - Primary auth gate, shows UnauthorizedPage if not logged in
 * 2. AuthErrorBoundary - Catches stale session errors and redirects to login
 * 3. Suspense - Provides loading state while content loads
 *
 * The AuthErrorBoundary handles edge cases where the frontend auth state
 * is stale (says authenticated) but the backend rejects the session.
 * Instead of crashing, users are gracefully redirected to login.
 *
 * ChatroomListingProvider is mounted in the root layout (apps/webapp/src/app/layout.tsx)
 * to warm up subscriptions eagerly at app start (before the user navigates to /app).
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RequireLogin>
      <AuthErrorBoundary>
        <ChatroomSwitcher />
        <Suspense fallback={<PageSpinner />}>{children}</Suspense>
      </AuthErrorBoundary>
    </RequireLogin>
  );
}
