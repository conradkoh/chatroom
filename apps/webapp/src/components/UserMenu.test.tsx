import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMenu } from './UserMenu';

import { useHasPermission } from '@/application/auth';
import { useAuthState } from '@/modules/auth/AuthProvider';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/modules/auth/AuthProvider', () => ({ useAuthState: vi.fn() }));
vi.mock('@/modules/pwa-install', () => ({
  usePwaInstall: vi.fn(() => ({
    platform: 'unknown',
    isInstalled: false,
    canNativeInstall: false,
    isReady: false,
    dialogOpen: false,
    setDialogOpen: vi.fn(),
    promptInstall: vi.fn(),
  })),
}));
vi.mock('@/application/auth', () => ({
  useHasPermission: vi.fn(() => false),
  SYSTEM_ADMIN_ACCESS_PERMISSION: 'system_admin:access',
  ADMIN_ACCESS_PERMISSION: 'admin:access',
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.logout,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/modules/pwa-install', () => ({
  usePwaInstall: vi.fn(() => ({
    isInstalled: false,
    isReady: true,
    setDialogOpen: vi.fn(),
  })),
}));

/**
 * Builds an authenticated auth state so the menu renders.
 */
function authenticatedState(name: string): ReturnType<typeof useAuthState> {
  return {
    sessionId: 's',
    state: 'authenticated',
    user: { _id: 'u' as Id<'users'>, _creationTime: 0, type: 'anonymous', name },
    accessLevel: 'user',
    permissions: [],
  };
}

/**
 * Opens the user dropdown and the logout confirm dialog.
 */
async function openLogoutDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Dana' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Log out' }));
  return screen.findByRole('alertdialog');
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.mocked(useHasPermission).mockReturnValue(false);
  });

  it('renders nothing when unauthenticated', () => {
    vi.mocked(useAuthState).mockReturnValue({
      sessionId: 's',
      state: 'unauthenticated',
      reason: 'test',
    });
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders user name when authenticated', () => {
    vi.mocked(useAuthState).mockReturnValue({
      sessionId: 's',
      state: 'authenticated',
      user: { _id: 'u' as Id<'users'>, _creationTime: 0, type: 'anonymous', name: 'Alice' },
      accessLevel: 'user',
      permissions: [],
    });
    render(<UserMenu />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows Admin link when user has admin:access', async () => {
    vi.mocked(useHasPermission).mockImplementation((perm) => perm === 'admin:access');
    vi.mocked(useAuthState).mockReturnValue({
      sessionId: 's',
      state: 'authenticated',
      user: { _id: 'u' as Id<'users'>, _creationTime: 0, type: 'anonymous', name: 'Bob' },
      accessLevel: 'user',
      permissions: [],
    });
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole('button', { name: 'Bob' }));
    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'System Admin' })).not.toBeInTheDocument();
  });

  it('shows both Admin and System Admin links for system admins', async () => {
    vi.mocked(useHasPermission).mockImplementation(
      (perm) => perm === 'admin:access' || perm === 'system_admin:access'
    );
    vi.mocked(useAuthState).mockReturnValue({
      sessionId: 's',
      state: 'authenticated',
      user: { _id: 'u' as Id<'users'>, _creationTime: 0, type: 'anonymous', name: 'Carol' },
      accessLevel: 'user',
      permissions: [],
    });
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole('button', { name: 'Carol' }));
    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'System Admin' })).toBeInTheDocument();
  });

  describe('logout', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(useHasPermission).mockReturnValue(false);
      mocks.logout.mockReset();
      mocks.push.mockReset();
      mocks.logout.mockResolvedValue(undefined);
      vi.mocked(useAuthState).mockReturnValue(authenticatedState('Dana'));
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('shows the logout failure inside the still-open confirm dialog', async () => {
      mocks.logout.mockRejectedValueOnce(new Error('network'));
      const user = userEvent.setup();
      render(<UserMenu />);

      const dialog = await openLogoutDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));

      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Failed to logout. Please try again.'
      );
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it('clears the message on retry and navigates on success', async () => {
      mocks.logout.mockRejectedValueOnce(new Error('network'));
      const user = userEvent.setup();
      render(<UserMenu />);

      const dialog = await openLogoutDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));

      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('clears the message when the dialog closes', async () => {
      mocks.logout.mockRejectedValueOnce(new Error('network'));
      const user = userEvent.setup();
      render(<UserMenu />);

      const dialog = await openLogoutDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

      await openLogoutDialog(user);

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('blocks Cancel, Escape, and overlay dismissal while logging out, then shows the failure', async () => {
      let rejectLogout!: (reason: unknown) => void;
      mocks.logout.mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectLogout = reject;
        })
      );
      const user = userEvent.setup();
      render(<UserMenu />);

      const dialog = await openLogoutDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Log out' }));
      expect(within(dialog).getByRole('button', { name: 'Logging out...' })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

      await user.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
      expect(overlay).not.toBeNull();
      await user.click(overlay as Element);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      rejectLogout(new Error('network'));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Failed to logout. Please try again.'
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });
});
