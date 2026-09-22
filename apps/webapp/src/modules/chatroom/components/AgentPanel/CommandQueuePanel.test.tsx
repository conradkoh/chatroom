import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandQueuePanel } from './CommandQueuePanel';

type QueueCommand = Doc<'chatroom_machineCommandInbox'>;

const mocks = vi.hoisted(() => ({
  commands: [] as QueueCommand[],
  deleteCommand: vi.fn().mockResolvedValue({ deleted: true }),
  deleteAll: vi.fn().mockResolvedValue({ deletedCount: 0 }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    daemon: {
      machineCommandInbox: {
        list: 'machineCommandInbox:list',
        deleteCommand: 'machineCommandInbox:deleteCommand',
        deleteAll: 'machineCommandInbox:deleteAll',
      },
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.commands,
  useSessionMutation: (ref: string) => {
    if (ref === 'machineCommandInbox:deleteCommand') return mocks.deleteCommand;
    if (ref === 'machineCommandInbox:deleteAll') return mocks.deleteAll;
    return vi.fn();
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="queue-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogScrollBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="flush-dialog">{children}</div> : null,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

function makeCommand(
  id: string,
  command: QueueCommand['command'],
  status: QueueCommand['status'] = 'pending'
): QueueCommand {
  return {
    _id: id as Id<'chatroom_machineCommandInbox'>,
    _creationTime: 1_000,
    machineId: 'machine-1',
    command,
    createdAt: 1_000,
    deadline: 2_000,
    attemptCount: 0,
    status,
    ...(status === 'processing' ? { claimedBySessionId: 'session-1', leaseExpiresAt: 1_500 } : {}),
  } as QueueCommand;
}

describe('CommandQueuePanel', () => {
  beforeEach(() => {
    mocks.commands = [
      makeCommand('cmd-1', {
        type: 'agent.requestStart',
        requestId: 'request-1',
        chatroomId: 'room-1' as Id<'chatroom_rooms'>,
        role: 'planner',
        agentHarness: 'codex-sdk',
        model: 'gpt-5',
        workingDir: '/workspace',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
      }),
      makeCommand('cmd-2', { type: 'daemon.ping' }, 'processing'),
    ];
    mocks.deleteCommand.mockClear();
    mocks.deleteAll.mockClear();
  });

  it('shows the queued count and opens the command list', () => {
    render(<CommandQueuePanel machineId="machine-1" />);

    expect(screen.getByLabelText('2 queued commands')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('command-queue-panel'));

    expect(screen.getByTestId('queue-dialog')).toBeInTheDocument();
    expect(screen.getByText('Start planner')).toBeInTheDocument();
    expect(screen.getByText('Daemon ping')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });

  it('uses chatroom industrial buttons in the queue footer', () => {
    render(<CommandQueuePanel machineId="machine-1" />);
    fireEvent.click(screen.getByTestId('command-queue-panel'));

    const closeButton = screen.getByRole('button', { name: 'Close' });
    const flushButton = screen.getAllByRole('button', { name: 'Flush queue' })[0];

    expect(closeButton).toHaveClass('rounded-none', 'h-9', 'border-chatroom-border');
    expect(flushButton).toHaveClass('rounded-none', 'h-9', 'bg-chatroom-status-error');
    expect(closeButton).not.toHaveAttribute('data-slot', 'button');
    expect(flushButton).not.toHaveAttribute('data-slot', 'button');
  });

  it('deletes an individual queued command', async () => {
    render(<CommandQueuePanel machineId="machine-1" />);
    fireEvent.click(screen.getByTestId('command-queue-panel'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Start planner' }));

    await waitFor(() => expect(mocks.deleteCommand).toHaveBeenCalledWith({ commandId: 'cmd-1' }));
  });

  it('confirms before flushing the entire queue', async () => {
    render(<CommandQueuePanel machineId="machine-1" />);
    fireEvent.click(screen.getByTestId('command-queue-panel'));
    fireEvent.click(screen.getByRole('button', { name: 'Flush queue' }));

    expect(screen.getByTestId('flush-dialog')).toBeInTheDocument();
    expect(screen.getByText('Flush command queue?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Flush queue' })[1]);

    await waitFor(() => expect(mocks.deleteAll).toHaveBeenCalledWith({ machineId: 'machine-1' }));
  });
});
