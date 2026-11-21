import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import UserRolesPage from './page';

const mocks = vi.hoisted(() => ({
  users: undefined as unknown,
  canManageSystemAdmins: true,
  updateUserRoles: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    admin: {
      users: {
        listUsers: 'admin/users:listUsers',
        updateUserRoles: 'admin/users:updateUserRoles',
      },
    },
  },
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.users,
  useSessionMutation: (ref: string) =>
    ({
      'admin/users:updateUserRoles': mocks.updateUserRoles,
    })[ref],
}));
vi.mock('@/application/auth', () => ({
  SYSTEM_ADMIN_ACCESS_PERMISSION: 'system_admin:access',
  useHasPermission: () => mocks.canManageSystemAdmins,
}));

const ada = {
  _id: 'user-1' as Id<'users'>,
  name: 'Ada',
  email: 'ada@example.com',
  type: 'full',
  effectiveRole: 'standard_user',
};
const grace = {
  _id: 'user-2' as Id<'users'>,
  name: 'Grace',
  email: 'grace@example.com',
  type: 'full',
  effectiveRole: 'admin',
};

beforeAll(() => {
  // Radix Select relies on pointer-capture and scrolling APIs that jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  mocks.users = [ada, grace];
  mocks.canManageSystemAdmins = true;
  mocks.updateUserRoles.mockReset().mockResolvedValue(undefined);
});

function getRow(name: string) {
  const row = screen.getByText(name).parentElement?.parentElement;
  if (!row) throw new Error(`No user row for ${name}`);
  return within(row);
}

async function chooseRole(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  roleLabel: string
) {
  await user.click(getRow(name).getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: roleLabel }));
}

describe('UserRolesPage role update failure feedback', () => {
  it('shows one destructive alert above the list when a role update is rejected', async () => {
    mocks.updateUserRoles.mockRejectedValueOnce(new Error('Cannot change role'));
    const user = userEvent.setup();
    render(<UserRolesPage />);

    await chooseRole(user, 'Ada', 'Admin');

    expect(mocks.updateUserRoles).toHaveBeenCalledWith({
      userId: 'user-1',
      effectiveRole: 'admin',
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot change role');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      alert.compareDocumentPosition(screen.getByText('All Users')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('falls back to the default message when the rejection is not an Error', async () => {
    mocks.updateUserRoles.mockRejectedValueOnce('boom');
    const user = userEvent.setup();
    render(<UserRolesPage />);

    await chooseRole(user, 'Ada', 'Admin');

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update role');
  });

  it('clears the alert as soon as the next role change starts', async () => {
    mocks.updateUserRoles.mockRejectedValueOnce(new Error('Cannot change role'));
    let resolveNext!: () => void;
    mocks.updateUserRoles.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveNext = resolve;
      })
    );
    const user = userEvent.setup();
    render(<UserRolesPage />);
    await chooseRole(user, 'Ada', 'Admin');
    await screen.findByRole('alert');

    await chooseRole(user, 'Ada', 'System Administrator');

    // Cleared while the second request is still pending, not after it settles.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    resolveNext();
    await waitFor(() =>
      expect(mocks.updateUserRoles).toHaveBeenLastCalledWith({
        userId: 'user-1',
        effectiveRole: 'system_admin',
      })
    );
  });

  it('shows no message on success and reflects the new role from the live query', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UserRolesPage />);

    await chooseRole(user, 'Ada', 'Admin');
    await waitFor(() =>
      expect(mocks.updateUserRoles).toHaveBeenCalledWith({
        userId: 'user-1',
        effectiveRole: 'admin',
      })
    );

    mocks.users = [{ ...ada, effectiveRole: 'admin' }, grace];
    rerender(<UserRolesPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The trigger's value span carries the role label; its sibling icon contributes a caret glyph.
    expect(getRow('Ada').getByText('Admin')).toBeInTheDocument();
  });
});
