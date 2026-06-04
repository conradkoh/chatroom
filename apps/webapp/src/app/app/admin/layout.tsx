'use client';

import { ArrowLeft, Loader2, Menu, Settings, Shield, ShieldX, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { RequirePermission, SYSTEM_ADMIN_ACCESS_PERMISSION } from '@/application/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuthState } from '@/modules/auth/AuthProvider';

interface SystemAdminLayoutProps {
  children: React.ReactNode;
}

/** Layout for `/app/admin` — platform system administration (not business/org admin). */
export default function SystemAdminLayout({ children }: SystemAdminLayoutProps) {
  const authState = useAuthState();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleBackdropKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    if (authState?.state === 'unauthenticated') {
      router.push('/login');
    }
  }, [authState, router]);

  if (authState === undefined) {
    return _renderAuthLoading('Checking access permissions...');
  }

  if (authState.state === 'unauthenticated') {
    return _renderAuthLoading('Redirecting to login...');
  }

  return (
    <RequirePermission
      permission={SYSTEM_ADMIN_ACCESS_PERMISSION}
      fallback={_renderSystemAdminAccessDenied()}
    >
      <div className="flex h-full min-h-0">
        {_renderMobileHeader(openSidebar)}
        {_renderMobileSidebar(sidebarOpen, closeSidebar, handleBackdropKeyDown)}
        {_renderDesktopSidebar(closeSidebar)}
        {_renderMainContent(children)}
      </div>
    </RequirePermission>
  );
}

function _renderAuthLoading(message: string) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function _renderSystemAdminAccessDenied() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="p-8">
          <div className="space-y-6 text-center">
            <ShieldX className="mx-auto h-16 w-16 text-destructive/60" />
            <h1 className="text-2xl font-semibold">Access Denied</h1>
            <p className="text-muted-foreground">
              You need <span className="font-medium">system administrator</span> access (
              <span className="font-medium">{SYSTEM_ADMIN_ACCESS_PERMISSION}</span>).
            </p>
            <Link href="/app">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Return to Application
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function _renderMobileHeader(openSidebar: () => void) {
  return (
    <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b p-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={openSidebar}>
          <Menu className="h-4 w-4 mr-2" />
          System Admin
        </Button>
        <Link href="/app">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function _renderMobileSidebar(
  sidebarOpen: boolean,
  closeSidebar: () => void,
  handleBackdropKeyDown: (e: React.KeyboardEvent) => void
) {
  if (!sidebarOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div
        className="fixed left-0 top-0 bottom-0 w-64 bg-background border-r p-4"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {_renderSidebarContent(closeSidebar)}
      </div>
      {/* Backdrop area to close sidebar */}
      <div
        className="fixed inset-0 -z-10"
        onClick={closeSidebar}
        onKeyDown={handleBackdropKeyDown}
        aria-hidden="true"
      />
    </div>
  );
}

function _renderDesktopSidebar(closeSidebar: () => void) {
  return (
    <div className="hidden lg:block w-64 border-r bg-muted/10 p-4">
      {_renderSidebarContent(closeSidebar)}
    </div>
  );
}

function _renderMainContent(children: React.ReactNode) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <div className="pt-20 lg:pt-0 p-4 lg:p-6">{children}</div>
    </div>
  );
}

function _renderSidebarContent(closeSidebar: () => void) {
  return (
    <div className="space-y-4 h-full">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between lg:justify-start">
          <Link href="/app">
            <Button variant="ghost" size="sm" className="justify-start">
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Back to App</span>
            </Button>
          </Link>
          {/* Close button for mobile */}
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={closeSidebar}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="border-b pb-2">
          <h2 className="text-lg font-semibold">System Admin</h2>
          <p className="text-sm text-muted-foreground">Platform administration</p>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="space-y-2">
        <Link
          href="/app/admin"
          className="flex items-center space-x-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
          onClick={closeSidebar}
        >
          <Settings className="h-4 w-4" />
          <span>Dashboard</span>
        </Link>

        <Link
          href="/app/admin/google-auth"
          className="flex items-center space-x-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
          onClick={closeSidebar}
        >
          <Shield className="h-4 w-4" />
          <span>Google Auth Config</span>
        </Link>
      </nav>

      {/* Admin Info */}
      <div className="mt-8">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            <p className="font-medium">System Administrator</p>
            <p className="mt-1">You have full system access</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
