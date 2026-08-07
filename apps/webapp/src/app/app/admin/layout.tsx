'use client';

import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Settings,
  Shield,
  ShieldX,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { RequirePermission, SYSTEM_ADMIN_ACCESS_PERMISSION } from '@/application/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthState } from '@/modules/auth/AuthProvider';

interface SystemAdminModule {
  href: string;
  label: string;
  icon: LucideIcon;
}

const SYSTEM_ADMIN_MODULES: SystemAdminModule[] = [
  { href: '/app/admin', label: 'Dashboard', icon: Settings },
  { href: '/app/admin/users', label: 'User Roles', icon: Users },
  { href: '/app/admin/invites', label: 'Invites', icon: Ticket },
  { href: '/app/admin/google-auth', label: 'Google Auth Config', icon: Shield },
];

function getActiveAdminModule(pathname: string): SystemAdminModule {
  return (
    [...SYSTEM_ADMIN_MODULES]
      .sort((a, b) => b.href.length - a.href.length)
      .find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`)) ??
    SYSTEM_ADMIN_MODULES[0]
  );
}

interface SystemAdminLayoutProps {
  children: React.ReactNode;
}

/** Layout for `/app/admin` — platform system administration (not business/org admin). */
export default function SystemAdminLayout({ children }: SystemAdminLayoutProps) {
  const authState = useAuthState();
  const router = useRouter();
  const pathname = usePathname();

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
      <div className="flex min-h-0 flex-1">
        {_renderDesktopSidebar(pathname)}
        <div className="flex min-h-0 flex-1 flex-col">
          {_renderMobileHeader(pathname)}
          {_renderMainContent(children)}
        </div>
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

function _renderMobileHeader(pathname: string) {
  const activeModule = getActiveAdminModule(pathname);
  const ActiveIcon = activeModule.icon;

  return (
    <div className="lg:hidden shrink-0 border-b bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-2 max-w-[70%]')}
          >
            <ActiveIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{activeModule.label}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>System Admin</DropdownMenuLabel>
              {SYSTEM_ADMIN_MODULES.map((module) => {
                const Icon = module.icon;
                const isActive = module.href === activeModule.href;
                return (
                  <Link key={module.href} href={module.href}>
                    <DropdownMenuItem
                      className={cn('cursor-pointer gap-2', isActive && 'bg-muted font-medium')}
                    >
                      <Icon className="h-4 w-4" />
                      {module.label}
                    </DropdownMenuItem>
                  </Link>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Link href="/app">
          <Button variant="ghost" size="sm" aria-label="Back to app">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function _renderDesktopSidebar(pathname: string) {
  return (
    <div className="hidden lg:block w-64 border-r bg-muted/10 p-4">
      {_renderSidebarContent(pathname)}
    </div>
  );
}

function _renderMainContent(children: React.ReactNode) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <div className="p-4 lg:p-6">{children}</div>
    </div>
  );
}

function _renderSidebarContent(pathname: string) {
  const activeModule = getActiveAdminModule(pathname);

  return (
    <div className="space-y-4 h-full">
      <div className="space-y-2">
        <Link href="/app">
          <Button variant="ghost" size="sm" className="justify-start">
            <ArrowLeft className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Back to App</span>
          </Button>
        </Link>
        <div className="border-b pb-2">
          <h2 className="text-lg font-semibold">System Admin</h2>
          <p className="text-sm text-muted-foreground">Platform administration</p>
        </div>
      </div>

      <nav className="space-y-2">
        {SYSTEM_ADMIN_MODULES.map((module) => {
          const Icon = module.icon;
          const isActive = module.href === activeModule.href;
          return (
            <Link
              key={module.href}
              href={module.href}
              className={cn(
                'flex items-center space-x-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors',
                isActive && 'bg-muted font-medium'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{module.label}</span>
            </Link>
          );
        })}
      </nav>

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
