import { render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { UserMenu } from './UserMenu';

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
  SYSTEM_ADMIN_ACCESS_PERMISSION: 'system:admin',
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
});
