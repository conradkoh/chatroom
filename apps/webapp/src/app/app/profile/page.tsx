'use client';

import Link from 'next/link';
import { Suspense, useMemo } from 'react';

import { SearchParamsErrorHandler } from '@/components/SearchParamsErrorHandler';
import { Button } from '@/components/ui/button';
import { useAuthState } from '@/modules/auth/AuthProvider';
import { LoginCodeGenerator } from '@/modules/auth/LoginCodeGenerator';
import { FileStorageSettings } from '@/modules/profile/FileStorageSettings';
import { NameEditForm } from '@/modules/profile/NameEditForm';
import { RecoveryCodeSection } from '@/modules/profile/RecoveryCodeSection';
import { ThemeSettings } from '@/modules/theme/ThemeSettings';

/**
 * Displays the user profile page with account management, theme settings, and recovery options.
 */
function ProfilePageContent() {
  const authState = useAuthState();

  const isAuthenticated = useMemo(() => {
    return authState?.state === 'authenticated' && !!authState?.user;
  }, [authState]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <h1 className="text-xl font-semibold mb-2">Profile</h1>
        <p className="text-sm text-muted-foreground">
          You need to be logged in to view your profile.
        </p>
        <Link href="/login" className="mt-4">
          <Button>Log In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Profile</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Manage your account information and preferences.
        </p>

        <div className="border-t pt-6">
          <h2 className="text-xl font-semibold mb-2">Account Information</h2>
          <div className="space-y-4">
            <NameEditForm />
            <LoginCodeGenerator />
          </div>
        </div>

        <ThemeSettings />

        <FileStorageSettings />

        <RecoveryCodeSection />
      </div>
    </div>
  );
}

/**
 * Loading state for the profile page
 */
function ProfilePageLoading() {
  return (
    <div className="container max-w-2xl mx-auto p-4">
      <div className="animate-pulse space-y-6">
        <div>
          <div className="h-8 bg-muted rounded w-32 mb-2" />
          <div className="h-4 bg-muted rounded w-64 mb-6" />
        </div>
        <div className="border-t pt-6">
          <div className="h-6 bg-muted rounded w-48 mb-4" />
          <div className="space-y-4">
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Main profile page component with Suspense boundary
 */
export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfilePageLoading />}>
      <div className="container max-w-2xl mx-auto px-4">
        <SearchParamsErrorHandler className="mt-4" />
      </div>
      <ProfilePageContent />
    </Suspense>
  );
}
