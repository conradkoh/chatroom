import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMenu } from './UserMenu';

import { useHasPermission } from '@/application/auth';
import { useAuthState } from '@/modules/auth/AuthProvider';

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
  useSessionMutation: vi.fn(() => vi.fn()),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
});
