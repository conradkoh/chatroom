import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mockAliceSignedIn() {
  vi.mocked(useAuthState).mockReturnValue({
    sessionId: 's',
    state: 'authenticated',
    user: { _id: 'u' as Id<'users'>, _creationTime: 0, type: 'anonymous', name: 'Alice' },
    accessLevel: 'user',
    permissions: [],
  });
}

async function chooseLogoutAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Alice' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Log out' }));
  await user.click(await screen.findByRole('button', { name: 'Log out' }));
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logout.mockReset();
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
    it('shows a failed logout as alert text beside the trigger and does not redirect', async () => {
      mocks.logout.mockRejectedValueOnce(new Error('boom'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockAliceSignedIn();
      const user = userEvent.setup();
      render(<UserMenu />);
      await chooseLogoutAndConfirm(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to logout. Please try again.'
      );
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it('redirects to / on a successful logout with no message', async () => {
      mocks.logout.mockResolvedValueOnce(undefined);

      mockAliceSignedIn();
      const user = userEvent.setup();
      render(<UserMenu />);
      await chooseLogoutAndConfirm(user);

      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Logged out successfully')).not.toBeInTheDocument();
    });

    it('clears the failure when the next attempt starts', async () => {
      mocks.logout.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockAliceSignedIn();
      const user = userEvent.setup();
      render(<UserMenu />);

      await chooseLogoutAndConfirm(user);
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await chooseLogoutAndConfirm(user);

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });
});
