import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/admin/invites';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InvitesPage from './page';

import { useIsMobile } from '@/hooks/useIsMobile';

const mocks = vi.hoisted(() => ({
  invites: undefined as unknown,
  createInvite: vi.fn(),
  disableInvite: vi.fn(),
  enableInvite: vi.fn(),
  deleteInvite: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    admin: {
      invites: {
        listInvites: 'admin/invites:listInvites',
        createInvite: 'admin/invites:createInvite',
        disableInvite: 'admin/invites:disableInvite',
        enableInvite: 'admin/invites:enableInvite',
        deleteInvite: 'admin/invites:deleteInvite',
      },
    },
  },
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.invites,
  useSessionMutation: (ref: string) =>
    ({
      'admin/invites:createInvite': mocks.createInvite,
      'admin/invites:disableInvite': mocks.disableInvite,
      'admin/invites:enableInvite': mocks.enableInvite,
      'admin/invites:deleteInvite': mocks.deleteInvite,
    })[ref],
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));

const activeInvite: InviteSummary = {
  _id: 'invite-1' as Id<'invites'>,
  code: 'ABCDEFGH',
  inviteeName: 'Ada',
  inviteeEmail: 'ada@example.com',
  createdAt: 0,
  disabled: false,
  status: 'active',
};
const disabledInvite: InviteSummary = {
  ...activeInvite,
  _id: 'invite-2' as Id<'invites'>,
  inviteeEmail: 'grace@example.com',
  disabled: true,
  status: 'disabled',
};

function getRow(rowText: string) {
  const row = screen.getByText(rowText).parentElement?.parentElement;
  if (!row) throw new Error(`No invite row for ${rowText}`);
  return within(row);
}

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>, index = 0) {
  await user.click(screen.getAllByRole('button', { name: 'Delete invite' })[index]);
  return screen.findByRole('alertdialog');
}

beforeEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
  mocks.invites = [activeInvite, disabledInvite];
  mocks.createInvite.mockReset().mockResolvedValue(undefined);
  mocks.disableInvite.mockReset().mockResolvedValue(undefined);
  mocks.enableInvite.mockReset().mockResolvedValue(undefined);
  mocks.deleteInvite.mockReset().mockResolvedValue(undefined);
});

describe('InvitesPage disable and enable failure feedback', () => {
  it('shows one alert above the list when disable is rejected', async () => {
    mocks.disableInvite.mockRejectedValueOnce(new Error('Cannot disable'));
    const user = userEvent.setup();
    render(<InvitesPage />);

    await user.click(getRow('Ada · ada@example.com').getByRole('button', { name: 'Disable' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot disable');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      alert.compareDocumentPosition(screen.getByText('All Invites')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('falls back to the default message when the rejection is not an Error', async () => {
    mocks.disableInvite.mockRejectedValueOnce('boom');
    const user = userEvent.setup();
    render(<InvitesPage />);

    await user.click(getRow('Ada · ada@example.com').getByRole('button', { name: 'Disable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Operation failed');
  });

  it('shows the same list alert when enable is rejected', async () => {
    mocks.invites = [disabledInvite];
    mocks.enableInvite.mockRejectedValueOnce(new Error('Cannot enable'));
    const user = userEvent.setup();
    render(<InvitesPage />);

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot enable');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('clears the list alert when the next action starts', async () => {
    mocks.disableInvite.mockRejectedValueOnce(new Error('Cannot disable'));
    const user = userEvent.setup();
    render(<InvitesPage />);
    const disable = getRow('Ada · ada@example.com').getByRole('button', { name: 'Disable' });

    await user.click(disable);
    await screen.findByRole('alert');

    await user.click(disable);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders no message and leaves the row to the live query on successful disable', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InvitesPage />);

    await user.click(getRow('Ada · ada@example.com').getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(mocks.disableInvite).toHaveBeenCalledWith({ inviteId: 'invite-1' }));
    mocks.invites = [{ ...activeInvite, disabled: true, status: 'disabled' }, disabledInvite];
    rerender(<InvitesPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      getRow('Ada · ada@example.com').getByRole('button', { name: 'Enable' })
    ).toBeInTheDocument();
  });
});

describe('InvitesPage delete failure feedback', () => {
  it('keeps the dialog open with one alert inside it when delete is rejected', async () => {
    mocks.deleteInvite.mockRejectedValueOnce(new Error('Cannot delete'));
    const user = userEvent.setup();
    render(<InvitesPage />);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cannot delete');
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('clears the dialog alert when the delete is retried', async () => {
    mocks.deleteInvite.mockRejectedValueOnce(new Error('Cannot delete'));
    const user = userEvent.setup();
    render(<InvitesPage />);
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the dialog alert and target when the dialog is cancelled', async () => {
    mocks.deleteInvite.mockRejectedValueOnce(new Error('Cannot delete'));
    const user = userEvent.setup();
    render(<InvitesPage />);
    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    const reopened = await openDeleteDialog(user, 1);
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument();
    expect(reopened).toHaveTextContent('grace@example.com');
    expect(reopened).not.toHaveTextContent('ada@example.com');
  });

  it('keeps the dialog open and shows the failure when Escape is pressed mid-delete', async () => {
    let rejectDelete!: (e: unknown) => void;
    mocks.deleteInvite.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectDelete = reject;
      })
    );
    const user = userEvent.setup();
    render(<InvitesPage />);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(within(dialog).getByRole('button', { name: 'Deleting...' })).toBeDisabled();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    rejectDelete(new Error('Cannot delete'));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Cannot delete')
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('renders no message and leaves the row to the live query on successful delete', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InvitesPage />);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deleteInvite).toHaveBeenCalledWith({ inviteId: 'invite-1' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    mocks.invites = [disabledInvite];
    rerender(<InvitesPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Ada · ada@example.com')).not.toBeInTheDocument();
  });
});
