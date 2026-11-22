import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteMachineDialog } from './DeleteMachineDialog';
import type { DeleteMachineDialogProps } from './DeleteMachineDialog';

import type { MachineUsage } from '@/hooks/useMachineUsage';

const mocks = vi.hoisted(() => ({ deleteMachine: vi.fn() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.deleteMachine,
}));

const USAGE: MachineUsage = {
  activeWorkspaceCount: 1,
  activeChatroomCount: 1,
  capped: false,
};

const DELETED_RESULT = {
  status: 'deleted',
  purgeComplete: true,
  detachedWorkspaceCount: 1,
  affectedChatroomCount: 1,
} as const;

function renderDialog(overrides: Partial<DeleteMachineDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const props: DeleteMachineDialogProps = {
    open: true,
    onOpenChange,
    machine: { machineId: 'machine-1', displayName: 'home-server' },
    connected: false,
    usage: USAGE,
    ...overrides,
  };
  const utils = render(<DeleteMachineDialog {...props} />);
  return { onOpenChange, ...utils };
}

function confirmButton(): HTMLElement | null {
  return screen.queryByTestId('delete-machine-confirm');
}

describe('DeleteMachineDialog', () => {
  beforeEach(() => {
    mocks.deleteMachine.mockReset();
    mocks.deleteMachine.mockResolvedValue(DELETED_RESULT);
  });

  it('blocks deletion for an online machine and never renders a destructive action', () => {
    renderDialog({ connected: true });

    expect(screen.getByTestId('delete-machine-blocked')).toBeInTheDocument();
    expect(screen.getByText(/Stop the daemon and wait until it shows offline/)).toBeInTheDocument();
    expect(screen.getByText('chatroom machine daemon stop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete machine' })).toBeNull();
    expect(confirmButton()).toBeNull();
  });

  it('lists every consequence of deleting an offline machine', () => {
    renderDialog({ connected: false, usage: USAGE });

    expect(screen.getByText('Registration, capabilities and status')).toBeInTheDocument();
    expect(screen.getByText('Cached workspace data and pending commands')).toBeInTheDocument();
    expect(screen.getByText('Project roots and repository ledger')).toBeInTheDocument();
    expect(screen.getByText('1 workspace link, detached from 1 chatroom')).toBeInTheDocument();
    expect(screen.getByText('Chatrooms and their message history are kept')).toBeInTheDocument();
    expect(screen.getByText('Files on the computer are untouched')).toBeInTheDocument();
    expect(screen.getByText(/register it as a new machine/)).toBeInTheDocument();
    expect(screen.queryByTestId('delete-machine-error')).toBeNull();
  });

  it('pluralises detach counts and marks capped counts as lower bounds', () => {
    const { rerender } = renderDialog({
      usage: { activeWorkspaceCount: 3, activeChatroomCount: 2, capped: false },
    });

    expect(screen.getByText('3 workspace links, detached from 2 chatrooms')).toBeInTheDocument();

    rerender(
      <DeleteMachineDialog
        open
        onOpenChange={vi.fn()}
        machine={{ machineId: 'machine-1', displayName: 'home-server' }}
        connected={false}
        usage={{ activeWorkspaceCount: 500, activeChatroomCount: 120, capped: true }}
      />
    );

    expect(
      screen.getByText('500+ workspace links, detached from 120+ chatrooms')
    ).toBeInTheDocument();
  });

  it('says nothing is linked when the machine has no active workspaces', () => {
    renderDialog({
      usage: { activeWorkspaceCount: 0, activeChatroomCount: 0, capped: false },
    });

    expect(screen.getByText('No chatrooms are linked to this machine.')).toBeInTheDocument();
  });

  it('keeps the confirm action disabled until connectivity is known-offline and usage has loaded', () => {
    const { rerender } = renderDialog({ connected: undefined, usage: USAGE });
    expect(confirmButton()).toBeDisabled();

    rerender(
      <DeleteMachineDialog
        open
        onOpenChange={vi.fn()}
        machine={{ machineId: 'machine-1', displayName: 'home-server' }}
        connected={false}
        usage={undefined}
      />
    );
    expect(confirmButton()).toBeDisabled();
    expect(
      screen.getByTestId('delete-machine-usage').querySelector('[data-slot="skeleton"]')
    ).not.toBeNull();

    rerender(
      <DeleteMachineDialog
        open
        onOpenChange={vi.fn()}
        machine={{ machineId: 'machine-1', displayName: 'home-server' }}
        connected={false}
        usage={USAGE}
      />
    );
    expect(confirmButton()).toBeEnabled();
  });

  it('never enables the confirm action while connectivity is reported online', () => {
    renderDialog({ connected: true, usage: USAGE });

    expect(confirmButton()).toBeNull();
  });

  it('focuses Cancel when the dialog opens', async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  });

  it('deletes the machine and closes without a success message', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    expect(mocks.deleteMachine).toHaveBeenCalledWith({ machineId: 'machine-1' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes without a message while background cleanup is still running', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockResolvedValue({ ...DELETED_RESULT, purgeComplete: false });
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes an already-deleted machine without a message', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockResolvedValue({ status: 'already_deleted' });
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks dismissal while the delete is pending', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockReturnValue(new Promise(() => undefined));
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    const action = confirmButton() as HTMLElement;
    expect(action.textContent).toContain('Deleting…');
    expect(action).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('flips to the blocked variant when the server rejects an online machine', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockRejectedValue(
      new ConvexError({ code: 'MACHINE_ONLINE', message: 'Machine is online' })
    );
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    expect(await screen.findByTestId('delete-machine-blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete machine' })).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open with an inline alert when the machine no longer exists', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockRejectedValue(new ConvexError({ code: 'MACHINE_NOT_FOUND' }));
    const { onOpenChange } = renderDialog();

    await user.click(confirmButton() as HTMLElement);

    const error = await screen.findByTestId('delete-machine-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('This machine no longer exists.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows friendly copy for an unknown failure and allows a retry', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockRejectedValueOnce(new Error('[CONVEX M(machines:deleteMachine)] boom'));
    renderDialog();

    await user.click(confirmButton() as HTMLElement);

    const error = await screen.findByTestId('delete-machine-error');
    expect(error.textContent).toBe('Could not delete the machine. Try again.');
    expect(error.textContent).not.toContain('CONVEX');

    const retry = confirmButton() as HTMLElement;
    expect(retry).toBeEnabled();
    await user.click(retry);

    expect(mocks.deleteMachine).toHaveBeenCalledTimes(2);
  });

  it('follows live connectivity changes', async () => {
    const { rerender } = renderDialog({ connected: true });

    expect(screen.getByTestId('delete-machine-blocked')).toBeInTheDocument();

    const props = {
      open: true,
      onOpenChange: vi.fn(),
      machine: { machineId: 'machine-1', displayName: 'home-server' },
      usage: USAGE,
    };

    rerender(<DeleteMachineDialog {...props} connected={false} />);
    expect(screen.getByTestId('delete-machine-confirm-body')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-machine-blocked')).toBeNull();

    rerender(<DeleteMachineDialog {...props} connected />);
    expect(screen.getByTestId('delete-machine-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-machine-confirm-body')).toBeNull();
  });

  it('switches from blocked to confirm once the machine goes offline after a server MACHINE_ONLINE rejection', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockRejectedValue(
      new ConvexError({ code: 'MACHINE_ONLINE', message: 'Machine is online' })
    );
    const { rerender, onOpenChange } = renderDialog({ connected: false, usage: USAGE });

    await user.click(confirmButton() as HTMLElement);
    expect(await screen.findByTestId('delete-machine-blocked')).toBeInTheDocument();

    const props = {
      open: true,
      onOpenChange,
      machine: { machineId: 'machine-1', displayName: 'home-server' },
      usage: USAGE,
    };
    rerender(<DeleteMachineDialog {...props} connected />);
    expect(screen.getByTestId('delete-machine-blocked')).toBeInTheDocument();

    rerender(<DeleteMachineDialog {...props} connected={false} />);
    expect(screen.queryByTestId('delete-machine-blocked')).toBeNull();
    expect(screen.getByTestId('delete-machine-confirm-body')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps confirm disabled after a server MACHINE_ONLINE rejection goes offline while usage is still loading', async () => {
    const user = userEvent.setup();
    mocks.deleteMachine.mockRejectedValue(
      new ConvexError({ code: 'MACHINE_ONLINE', message: 'Machine is online' })
    );
    const { rerender, onOpenChange } = renderDialog({ connected: false, usage: USAGE });

    await user.click(confirmButton() as HTMLElement);
    expect(await screen.findByTestId('delete-machine-blocked')).toBeInTheDocument();

    const props = {
      open: true,
      onOpenChange,
      machine: { machineId: 'machine-1', displayName: 'home-server' },
    };
    rerender(<DeleteMachineDialog {...props} connected usage={USAGE} />);
    rerender(<DeleteMachineDialog {...props} connected={false} usage={undefined} />);

    expect(screen.queryByTestId('delete-machine-blocked')).toBeNull();
    expect(screen.getByTestId('delete-machine-confirm-body')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    rerender(<DeleteMachineDialog {...props} connected={false} usage={USAGE} />);
    expect(confirmButton()).toBeEnabled();
  });
});
