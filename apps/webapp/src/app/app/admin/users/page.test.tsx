import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { UserSummary } from '@workspace/backend/convex/admin/users';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UserRolesPage from './page';

const mocks = vi.hoisted(() => ({
  users: [] as UserSummary[],
  updateUserRoles: vi.fn(),
}));

// Data port: the user admin functions, keyed by their generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'admin/users:listUsers') return mocks.users;
      throw new Error(`Unexpected query in UserRolesPage test: ${name}`);
    },
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'admin/users:updateUserRoles') return mocks.updateUserRoles;
      throw new Error(`Unexpected mutation in UserRolesPage test: ${name}`);
    },
  };
});

// Data port: the permission that decides whether system_admin is assignable.
vi.mock('@/application/auth', () => ({
  SYSTEM_ADMIN_ACCESS_PERMISSION: 'system_admin:access',
  useHasPermission: () => true,
}));

const alice: UserSummary = {
  _id: 'user-1' as Id<'users'>,
  name: 'Alice',
  email: 'alice@example.com',
  type: 'full',
  accessLevel: 'user',
  roleNames: [],
  effectiveRole: 'standard_user',
};

let user: ReturnType<typeof userEvent.setup>;

async function chooseRole(name: 'Admin' | 'System Administrator') {
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name }));
}

describe('UserRolesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.users = [alice];
    mocks.updateUserRoles.mockResolvedValue(undefined);
    user = userEvent.setup();
  });

  it('shows a failed role update as alert text in users-feedback', async () => {
    mocks.updateUserRoles.mockRejectedValueOnce(new Error('role boom'));

    render(<UserRolesPage />);
    await chooseRole('Admin');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'users-feedback');
    expect(alert).toHaveTextContent('role boom');
    expect(mocks.updateUserRoles).toHaveBeenCalledWith({
      userId: alice._id,
      effectiveRole: 'admin',
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('renders no alert or status text when the role update succeeds', async () => {
    render(<UserRolesPage />);
    await chooseRole('Admin');

    await waitFor(() => expect(mocks.updateUserRoles).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears the slot when the next role update starts', async () => {
    mocks.updateUserRoles.mockRejectedValueOnce(new Error('role boom'));

    render(<UserRolesPage />);
    await chooseRole('Admin');
    expect(await screen.findByTestId('users-feedback')).toBeInTheDocument();

    mocks.updateUserRoles.mockImplementation(() => new Promise(() => {}));
    await chooseRole('System Administrator');

    expect(screen.queryByTestId('users-feedback')).toBeNull();
  });
});
