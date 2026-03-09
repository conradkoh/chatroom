'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * User menu dropdown component with profile links and logout functionality.
 * Shows user information and navigation options, with admin access for system administrators.
 */
export function UserMenu() {
  const authState = useAuthState();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const logout = useSessionMutation(api.auth.logout);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      toast.success('Logged out successfully');
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Failed to logout. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout, router]);

  const showLogoutConfirmation = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  const handleLogoutConfirmChange = useCallback((open: boolean) => {
    setShowLogoutConfirm(open);
  }, []);

  return !authState || authState.state !== 'authenticated' ? null : (
    <>
      {_renderLogoutConfirmDialog(
        showLogoutConfirm,
        handleLogoutConfirmChange,
        handleLogout,
        isLoggingOut
      )}
      {_renderUserDropdownMenu(authState, showLogoutConfirmation, isLoggingOut)}
    </>
  );
}

// 5. Internal helper functions
/**
 * Renders the logout confirmation dialog.
 */
function _renderLogoutConfirmDialog(
  showLogoutConfirm: boolean,
  handleLogoutConfirmChange: (open: boolean) => void,
  handleLogout: () => void,
  isLoggingOut: boolean
) {
  return (
    <AlertDialog open={showLogoutConfirm} onOpenChange={handleLogoutConfirmChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
          <AlertDialogDescription>
            You will be redirected to the home page after logging out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoggingOut ? 'Logging out...' : 'Log out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Renders the user dropdown menu with navigation links.
 */
function _renderUserDropdownMenu(
  authState: Extract<NonNullable<ReturnType<typeof useAuthState>>, { state: 'authenticated' }>,
  showLogoutConfirmation: () => void,
  isLoggingOut: boolean
) {
  const isSystemAdmin = authState.user.accessLevel === 'system_admin';

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative flex items-center text-sm font-medium focus:outline-none text-muted-foreground hover:text-foreground"
        >
          {authState.user.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link href="/app/profile">
          <DropdownMenuItem className="cursor-pointer">Profile</DropdownMenuItem>
        </Link>
        <Link href="/app">
          <DropdownMenuItem className="cursor-pointer">Dashboard</DropdownMenuItem>
        </Link>
        {isSystemAdmin && (
          <Link href="/app/admin">
            <DropdownMenuItem className="cursor-pointer">
              <Settings className="h-4 w-4" />
              System Admin
            </DropdownMenuItem>
          </Link>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
          onClick={showLogoutConfirmation}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? 'Logging out...' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
