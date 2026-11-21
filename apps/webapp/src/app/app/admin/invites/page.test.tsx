import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/admin/invites';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InvitesPage from './page';

const mocks = vi.hoisted(() => ({
  invites: [] as InviteSummary[],
  createInvite: vi.fn(),
  disableInvite: vi.fn(),
  enableInvite: vi.fn(),
  deleteInvite: vi.fn(),
}));

// Data port: the invite admin functions, keyed by their generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'admin/invites:listInvites') return mocks.invites;
      throw new Error(`Unexpected query in InvitesPage test: ${name}`);
    },
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'admin/invites:createInvite') return mocks.createInvite;
      if (name === 'admin/invites:disableInvite') return mocks.disableInvite;
      if (name === 'admin/invites:enableInvite') return mocks.enableInvite;
      if (name === 'admin/invites:deleteInvite') return mocks.deleteInvite;
      throw new Error(`Unexpected mutation in InvitesPage test: ${name}`);
    },
  };
});

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

function makeInvite(overrides: Partial<InviteSummary> = {}): InviteSummary {
  return {
    _id: 'invite-1' as Id<'invites'>,
    code: 'ABCD2345',
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
    createdAt: 0,
    expiresAt: 1000,
    disabled: false,
    usedAt: undefined,
    status: 'active',
    ...overrides,
  };
}

let user: ReturnType<typeof userEvent.setup>;

describe('InvitesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invites = [makeInvite()];
    mocks.createInvite.mockResolvedValue({ code: 'WXYZ2345' });
    mocks.disableInvite.mockResolvedValue(undefined);
    mocks.enableInvite.mockResolvedValue(undefined);
    mocks.deleteInvite.mockResolvedValue(undefined);
    user = userEvent.setup();
  });

  it('shows a failed disable as alert text in invites-feedback', async () => {
    mocks.disableInvite.mockRejectedValueOnce(new Error('boom'));

    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'invites-feedback');
    expect(alert).toHaveTextContent('boom');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows a failed enable as alert text in invites-feedback', async () => {
    mocks.invites = [makeInvite({ disabled: true, status: 'disabled' })];
    mocks.enableInvite.mockRejectedValueOnce(new Error('nope'));

    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Enable' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'invites-feedback');
    expect(alert).toHaveTextContent('nope');
  });

  it('renders no alert or status text when enable succeeds', async () => {
    mocks.invites = [makeInvite({ disabled: true, status: 'disabled' })];

    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(mocks.enableInvite).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears the list slot when the next action starts', async () => {
    mocks.disableInvite.mockRejectedValueOnce(new Error('boom'));

    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByTestId('invites-feedback')).toBeInTheDocument();

    mocks.disableInvite.mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    expect(screen.queryByTestId('invites-feedback')).toBeNull();
  });

  it('keeps the delete dialog open and shows the failure inside it', async () => {
    mocks.deleteInvite.mockRejectedValueOnce(new Error('delete failed'));

    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Delete invite' }));
    const dialog = await screen.findByRole('alertdialog');

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByTestId('delete-invite-feedback');
    expect(alert).toHaveTextContent('delete failed');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(screen.getByRole('alertdialog')).getByTestId('delete-invite-feedback')).toBe(
      alert
    );
  });

  it('closes the delete dialog when the delete succeeds', async () => {
    render(<InvitesPage />);
    await user.click(screen.getByRole('button', { name: 'Delete invite' }));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
