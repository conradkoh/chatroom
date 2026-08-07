'use client';

import { isInviteSignupAllowed } from '@workspace/backend/config/signupMethods';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { InviteCodeForm } from '@/app/signup/invite/InviteCodeForm';
import { InviteSuccessPanel } from '@/app/signup/invite/InviteSuccessPanel';
import { useInviteSignupFlow } from '@/app/signup/invite/useInviteSignupFlow';
import { AuthPageLoading } from '@/modules/auth/AuthPageLoading';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Invite signup page — validates an invite code then offers Google OAuth for account creation.
 */
// fallow-ignore-next-line complexity
export default function InviteSignupPage() {
  const router = useRouter();
  const authState = useAuthState();
  const { code, pageState, error, inviteeName, handleCodeChange, handleSubmit } =
    useInviteSignupFlow();

  const isLoading = authState === undefined;
  const isAuthenticated = authState?.state === 'authenticated';
  const inviteAllowed = isInviteSignupAllowed();

  useEffect(() => {
    if (!inviteAllowed) {
      router.replace('/login');
    }
  }, [inviteAllowed, router]);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/app');
    }
  }, [isAuthenticated, router]);

  if (!inviteAllowed) {
    return null;
  }

  if (isLoading) {
    return <AuthPageLoading />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Sign Up with Invite</h1>
          <p className="text-sm text-muted-foreground">Enter your invite code to get started</p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-sm p-6">
          {pageState === 'success' && inviteeName ? (
            <InviteSuccessPanel inviteeName={inviteeName} />
          ) : (
            <InviteCodeForm
              code={code}
              error={error}
              pageState={pageState}
              onCodeChange={handleCodeChange}
              onSubmit={handleSubmit}
            />
          )}
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}
