/**
 * QueuedMessageDetailModal — Unit Tests
 *
 * Verifies:
 * - Attachments section renders with correct count when attachments are present.
 * - No attachments → no "Attachments" section.
 * - Attachments section is hidden during edit mode.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

import { QueuedMessageDetailModal } from './QueuedMessageDetailModal';
import type { Message } from '../../types/message';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      updateUserMessageOrTask: 'messages:updateUserMessageOrTask',
    },
  },
}));

// Mock dropdown menu — simplified so tests don't need Radix portals.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

// Mock FixedModal — render children directly so the body is visible.
vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    onClose?: () => void;
    maxWidth?: string;
    closeOnBackdrop?: boolean;
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode; onClose?: () => void }) => (
    <div>{children}</div>
  ),
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock AttachedMessageChip used inside the attachments section.
vi.mock('../../attachments/message/AttachedMessageChip', () => ({
  AttachedMessageChip: ({ content }: { content: string }) => (
    <div data-testid="attached-message-chip">{content}</div>
  ),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello world',
    _creationTime: Date.now(),
    isQueued: true,
    ...overrides,
  };
}

const noop = vi.fn().mockResolvedValue(undefined);

function renderModal(message: Message, isOpen = true) {
  return render(
    <QueuedMessageDetailModal
      chatroomId={'test-room' as Id<'chatroom_rooms'>}
      message={message}
      isOpen={isOpen}
      onClose={noop}
      onPromote={noop}
      onDelete={noop}
    />
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  noop.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueuedMessageDetailModal', () => {
  it('renders the message content', () => {
    renderModal(makeMessage({ content: 'My queued message' }));
    expect(screen.getByText('My queued message')).toBeInTheDocument();
  });

  it('no attachments → no "Attachments" section', () => {
    renderModal(makeMessage());
    expect(screen.queryByText(/^Attachments \(/)).not.toBeInTheDocument();
  });

  it('renders "Attachments (N)" header with correct total count', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Fix bug' }],
      attachedBacklogItems: [{ id: 'bl-1', content: 'Add feature', status: 'backlog' }],
    });
    renderModal(message);
    expect(screen.getByText('Attachments (2)')).toBeInTheDocument();
  });

  it('renders task content in attachments section', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Fix the critical bug' }],
    });
    renderModal(message);
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument();
    expect(screen.getByText('Fix the critical bug')).toBeInTheDocument();
  });

  it('renders attached message chip', () => {
    const message = makeMessage({
      attachedMessages: [
        { _id: 'am-1', content: 'Context message', senderRole: 'planner', _creationTime: 1000 },
      ],
    });
    renderModal(message);
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument();
    expect(screen.getByTestId('attached-message-chip')).toBeInTheDocument();
  });

  it('attachments section is hidden during edit mode', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Edit mode task' }],
    });
    renderModal(message);

    // Verify attachment section is visible initially
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument();

    // Enter edit mode via the "Edit" dropdown item
    const editButton = screen.getByText('Edit');
    act(() => {
      fireEvent.click(editButton);
    });

    // Attachments section should now be hidden
    expect(screen.queryByText('Attachments (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit mode task')).not.toBeInTheDocument();
  });

  it('attachments section reappears after cancelling edit', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Visible after cancel' }],
    });
    renderModal(message);

    // Enter edit mode
    act(() => {
      fireEvent.click(screen.getByText('Edit'));
    });
    expect(screen.queryByText('Attachments (1)')).not.toBeInTheDocument();

    // Cancel edit
    act(() => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    // Attachments should be visible again
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument();
    expect(screen.getByText('Visible after cancel')).toBeInTheDocument();
  });

  it('modal closed → nothing rendered', () => {
    const { container } = renderModal(makeMessage(), false);
    expect(container.firstChild).toBeNull();
  });

  it('modal closed → nothing rendered', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Fix the bug' }],
    });
    renderModal(message);

    // Click the task chip's "View attached task" button
    const chipButton = screen.getByLabelText('View attached task');
    act(() => {
      fireEvent.click(chipButton);
    });

    // The AttachedTaskChip's inner FixedModal should be open
    expect(screen.getByText('Attached Task')).toBeInTheDocument();
  });
});
