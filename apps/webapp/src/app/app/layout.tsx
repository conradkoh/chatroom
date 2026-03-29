'use client';

import { Suspense } from 'react';

import { PageSpinner } from '@/components/ui/spinner';
import { AuthErrorBoundary } from '@/modules/auth/AuthErrorBoundary';
import { RequireLogin } from '@/modules/auth/RequireLogin';
import { ChatroomSwitcher } from '@/modules/chatroom/components/ChatroomSwitcher';
import { GlobalNotificationListener } from '@/modules/chatroom/components/GlobalNotificationListener';
import { ChatroomListingProvider } from '@/modules/chatroom/context/ChatroomListingContext';

/**
 * Authenticated application layout.
 *
 * This layout provides a layered authentication system:
 * 1. RequireLogin - Primary auth gate, shows UnauthorizedPage if not logged in
 * 2. AuthErrorBoundary - Catches stale session errors and redirects to login
 * 3. ChatroomListingProvider - Chatroom data subscriptions (auth-gated)
 * 4. Suspense - Provides loading state while content loads
 *
 * The AuthErrorBoundary handles edge cases where the frontend auth state
 * is stale (says authenticated) but the backend rejects the session.
 * Instead of crashing, users are gracefully redirected to login.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RequireLogin>
      <AuthErrorBoundary>
        <ChatroomListingProvider>
          <ChatroomSwitcher />
          <GlobalNotificationListener />
          <Suspense fallback={<PageSpinner />}>{children}</Suspense>
        </ChatroomListingProvider>
      </AuthErrorBoundary>
    </RequireLogin>
  );
}
