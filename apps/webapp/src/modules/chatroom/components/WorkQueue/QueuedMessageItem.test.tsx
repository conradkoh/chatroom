/**
 * QueuedMessageItem — Unit Tests
 *
 * Verifies:
 * - No attachments → no chip strip rendered.
 * - One task attachment → chip rendered with task content visible.
 * - Clicking a chip does NOT open the queued-message detail modal (stopPropagation).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, _args: unknown) => [],
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      updateQueuedMessage: 'messages:updateQueuedMessage',
      deleteQueuedMessage: 'messages:deleteQueuedMessage',
    },
    tasks: {
      promoteSpecificTask: 'tasks:promoteSpecificTask',
    },
  },
}));

// Track whether the detail modal was opened.
let capturedIsOpen = false;
vi.mock('./QueuedMessageDetailModal', () => ({
  QueuedMessageDetailModal: ({ isOpen }: { isOpen: boolean }) => {
    capturedIsOpen = isOpen;
    return isOpen ? <div role="dialog">Detail Modal</div> : null;
  },
}));

// Mock chip components to render a simple button with the content so we can
// test click propagation without needing the real modal infrastructure.
vi.mock('../AttachedTaskChip', () => ({
  AttachedTaskChip: ({ content }: { content: string }) => (
    <button type="button" data-testid="task-chip">
      {content}
    </button>
  ),
}));
vi.mock('../AttachedBacklogItemChip', () => ({
  AttachedBacklogItemChip: ({ content }: { content: string }) => (
    <button type="button" data-testid="backlog-chip">
      {content}
    </button>
  ),
}));
vi.mock('../AttachedMessageChip', () => ({
  AttachedMessageChip: ({ content }: { content: string }) => (
    <button type="button" data-testid="message-chip">
      {content}
    </button>
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { QueuedMessageItem } from './QueuedMessageItem';
import type { Message } from '../../types/message';

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

function renderItem(message: Message) {
  return render(
    <QueuedMessageItem message={message} onPromote={noop} onDelete={noop} />
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedIsOpen = false;
  noop.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueuedMessageItem', () => {
  it('renders the message content', () => {
    renderItem(makeMessage({ content: 'My queued message' }));
    expect(screen.getByText('My queued message')).toBeInTheDocument();
  });

  it('no attachments → no chip strip rendered', () => {
    renderItem(makeMessage());
    expect(screen.queryByTestId('task-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlog-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-chip')).not.toBeInTheDocument();
  });

  it('one task attachment → chip rendered with task content', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Fix the bug' }],
    });
    renderItem(message);
    expect(screen.getByTestId('task-chip')).toBeInTheDocument();
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();
  });

  it('clicking a chip does NOT open the detail modal (stopPropagation)', () => {
    const message = makeMessage({
      attachedTasks: [{ _id: 'task-1', content: 'Fix the bug' }],
    });
    renderItem(message);

    // Modal should be closed initially
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click the chip — should NOT propagate to the row's openModal handler
    act(() => {
      fireEvent.click(screen.getByTestId('task-chip'));
    });

    // Modal should still be closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(capturedIsOpen).toBe(false);
  });

  it('clicking the row (not a chip) opens the detail modal', () => {
    renderItem(makeMessage({ content: 'row click test' }));

    // The row is a role="button" div whose accessible name includes the message content
    const row = screen.getByRole('button', { name: /row click test/i });
    act(() => {
      fireEvent.click(row);
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('backlog attachment → backlog chip rendered', () => {
    const message = makeMessage({
      attachedBacklogItems: [{ id: 'bl-1', content: 'Add feature X', status: 'backlog' }],
    });
    renderItem(message);
    expect(screen.getByTestId('backlog-chip')).toBeInTheDocument();
    expect(screen.getByText('Add feature X')).toBeInTheDocument();
  });

  it('message attachment → message chip rendered', () => {
    const message = makeMessage({
      attachedMessages: [
        { _id: 'am-1', content: 'See this context', senderRole: 'planner', _creationTime: 1000 },
      ],
    });
    renderItem(message);
    expect(screen.getByTestId('message-chip')).toBeInTheDocument();
    expect(screen.getByText('See this context')).toBeInTheDocument();
  });
});
