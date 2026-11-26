/**
 * QueuedMessageItem — Unit Tests
 *
 * Verifies:
 * - No attachments → no chip strip rendered.
 * - One task attachment → chip rendered with task content visible.
 * - Clicking a chip does NOT open the queued-message detail modal (stopPropagation).
 * - The shared envelope controls render in the row and their interactions do not
 *   open the detail modal, while row Enter/Space still does.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { createTaskEnvelope } from '@workspace/shared/domain/task-envelope';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

import { QueuedMessageItem } from './QueuedMessageItem';
import type { QueuedItemReorderProps } from '../../hooks/useQueuedMessageReorder';
import type { Message } from '../../types/message';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, _args: unknown) => [],
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      updateUserMessageOrTask: 'messages:updateUserMessageOrTask',
      deleteUserMessageOrTask: 'messages:deleteUserMessageOrTask',
      updateQueuedMessageEnvelope: 'messages:updateQueuedMessageEnvelope',
    },
    tasks: {},
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
vi.mock('../../attachments', () => ({
  MessageAttachmentChips: ({
    message,
  }: {
    message: {
      attachedTasks?: { _id: string; content: string }[];
      attachedBacklogItems?: { id: string; content: string }[];
      attachedMessages?: { _id: string; content: string }[];
    };
  }) => (
    <>
      {message.attachedTasks?.map((task: { _id: string; content: string }) => (
        <button key={task._id} type="button" data-testid="task-chip">
          {task.content}
        </button>
      ))}
      {message.attachedBacklogItems?.map((item: { id: string; content: string }) => (
        <button key={item.id} type="button" data-testid="backlog-chip">
          {item.content}
        </button>
      ))}
      {message.attachedMessages?.map((msg: { _id: string; content: string }) => (
        <button key={msg._id} type="button" data-testid="message-chip">
          {msg.content}
        </button>
      ))}
    </>
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

function renderItem(message: Message) {
  return render(
    <QueuedMessageItem
      chatroomId={'test-room' as Id<'chatroom_rooms'>}
      message={message}
      onDelete={noop}
    />
  );
}

function makeReorder(overrides: Partial<QueuedItemReorderProps> = {}): QueuedItemReorderProps {
  return {
    index: 0,
    total: 2,
    isNext: true,
    state: 'idle',
    dropEdge: null,
    canMoveUp: false,
    canMoveDown: true,
    registerHandle: vi.fn(),
    onHandleDragStart: vi.fn(),
    onHandleDragEnd: vi.fn(),
    onHandleActivate: vi.fn(),
    onHandleKeyDown: vi.fn(),
    onRowDragOver: vi.fn(),
    onRowDragLeave: vi.fn(),
    onRowDrop: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function renderItemWithReorder(message: Message, reorder: QueuedItemReorderProps) {
  return render(
    <QueuedMessageItem
      chatroomId={'test-room' as Id<'chatroom_rooms'>}
      message={message}
      onDelete={noop}
      reorder={reorder}
    />
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

  it('renders shared envelope controls for optional ephemeral design-role support', () => {
    renderItem(makeMessage());
    expect(screen.getByTestId('queued-message-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('queued-message-session-toggle')).toBeInTheDocument();
  });

  it('displays matching selections for a message with an explicit envelope', () => {
    const message = makeMessage({
      taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'new' }),
    });
    renderItem(message);
    expect(screen.getByTestId('queued-message-mode-toggle')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Chat')
    );
    expect(screen.getByTestId('queued-message-session-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('clicking or pressing Enter/Space on envelope controls does NOT open the detail modal', () => {
    renderItem(makeMessage());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const mode = screen.getByTestId('queued-message-mode-toggle');
    act(() => {
      fireEvent.click(mode);
      fireEvent.keyDown(mode, { key: 'Enter' });
      fireEvent.keyDown(mode, { key: ' ' });
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(capturedIsOpen).toBe(false);
  });

  it('row Enter/Space still opens the detail modal', async () => {
    renderItem(makeMessage({ content: 'keyboard row test' }));

    const row = screen.getByRole('button', { name: /keyboard row test/i });
    act(() => {
      fireEvent.keyDown(row, { key: 'Enter' });
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Reorder prop ──────────────────────────────────────────────────────────

  it('renders no handle or NEXT badge without the reorder prop', () => {
    renderItem(makeMessage({ content: 'plain row' }));

    expect(screen.queryByTestId('queued-reorder-handle-msg-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('renders the handle and the NEXT badge for the first row when reorder is present', () => {
    const reorder = makeReorder();
    renderItemWithReorder(makeMessage({ content: 'first row' }), reorder);

    const handle = screen.getByTestId('queued-reorder-handle-msg-1');
    expect(handle).toHaveAttribute('aria-label', 'Reorder: position 1 of 2');
    expect(handle).toHaveAttribute('title', 'Drag to reorder, or press Space to pick up');
    expect(handle).toHaveAttribute('draggable', 'true');
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('clicking the handle never opens the detail modal', () => {
    const reorder = makeReorder();
    renderItemWithReorder(makeMessage({ content: 'handle click test' }), reorder);

    act(() => {
      fireEvent.click(screen.getByTestId('queued-reorder-handle-msg-1'));
    });

    expect(reorder.onHandleActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(capturedIsOpen).toBe(false);
  });

  it('swaps the actions for move controls while lifted', () => {
    const reorder = makeReorder({ state: 'lifted', isNext: false });
    renderItemWithReorder(makeMessage({ content: 'lifted row' }), reorder);

    expect(screen.getByTestId('queued-move-up')).toBeInTheDocument();
    expect(screen.getByTestId('queued-move-down')).toBeInTheDocument();
    expect(screen.getByTestId('queued-move-done')).toBeInTheDocument();
    expect(screen.getByTestId('queued-move-cancel')).toBeInTheDocument();

    expect(screen.queryByTestId('queued-message-mode-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queued-message-session-toggle')).not.toBeInTheDocument();

    const handle = screen.getByTestId('queued-reorder-handle-msg-1');
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('move and done controls never open the detail modal', () => {
    const reorder = makeReorder({ state: 'lifted', canMoveUp: true, canMoveDown: true });
    renderItemWithReorder(makeMessage({ content: 'controls test' }), reorder);

    act(() => {
      fireEvent.click(screen.getByTestId('queued-move-up'));
      fireEvent.click(screen.getByTestId('queued-move-down'));
      fireEvent.click(screen.getByTestId('queued-move-done'));
      fireEvent.click(screen.getByTestId('queued-move-cancel'));
    });

    expect(reorder.onMoveUp).toHaveBeenCalledTimes(1);
    expect(reorder.onMoveDown).toHaveBeenCalledTimes(1);
    expect(reorder.onDone).toHaveBeenCalledTimes(1);
    expect(reorder.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(capturedIsOpen).toBe(false);
  });

  it('disables move controls at the ends', () => {
    const reorder = makeReorder({
      state: 'lifted',
      canMoveUp: false,
      canMoveDown: false,
    });
    renderItemWithReorder(makeMessage({ content: 'end row' }), reorder);

    expect(screen.getByTestId('queued-move-up')).toBeDisabled();
    expect(screen.getByTestId('queued-move-down')).toBeDisabled();
    expect(screen.getByTestId('queued-move-down')).toHaveAttribute('title', 'Already last');
  });

  it('shows a spinner instead of the handle while saving and locks other rows', () => {
    const { rerender } = renderItemWithReorder(
      makeMessage({ content: 'saving row' }),
      makeReorder({ state: 'saving', isNext: false })
    );

    expect(screen.getByTestId('queued-reorder-saving')).toBeInTheDocument();
    expect(screen.queryByTestId('queued-reorder-handle-msg-1')).not.toBeInTheDocument();
    // The other row's actions stay available; only handles are locked.
    expect(screen.getByTestId('queued-message-mode-toggle')).toBeInTheDocument();

    rerender(
      <QueuedMessageItem
        chatroomId={'test-room' as Id<'chatroom_rooms'>}
        message={makeMessage({ content: 'saving row' })}
        onDelete={noop}
        reorder={makeReorder({ state: 'locked', isNext: false })}
      />
    );

    const lockedHandle = screen.getByTestId('queued-reorder-handle-msg-1');
    expect(lockedHandle).toHaveAttribute('tabindex', '-1');
    expect(lockedHandle).toHaveAttribute('aria-disabled', 'true');
    expect(lockedHandle).toHaveAttribute('draggable', 'false');
  });

  it('marks the dragged and highlighted states on the row', () => {
    const { rerender } = renderItemWithReorder(
      makeMessage({ content: 'dragged row' }),
      makeReorder({ state: 'dragging', isNext: false })
    );
    expect(screen.getByTestId('queued-row-msg-1').className).toContain('opacity-50');

    rerender(
      <QueuedMessageItem
        chatroomId={'test-room' as Id<'chatroom_rooms'>}
        message={makeMessage({ content: 'dragged row' })}
        onDelete={noop}
        reorder={makeReorder({ dropEdge: 'before', isNext: false, index: 1 })}
      />
    );
    expect(screen.getByTestId('queued-row-msg-1').className).toContain('before:top-0');

    rerender(
      <QueuedMessageItem
        chatroomId={'test-room' as Id<'chatroom_rooms'>}
        message={makeMessage({ content: 'dragged row' })}
        onDelete={noop}
        reorder={makeReorder({ dropEdge: 'after', isNext: false })}
      />
    );
    expect(screen.getByTestId('queued-row-msg-1').className).toContain('before:bottom-0');
  });

  it('keeps the envelope and delete controls active with reorder present', () => {
    const reorder = makeReorder();
    renderItemWithReorder(makeMessage({ content: 'intact row' }), reorder);

    expect(screen.getByTestId('queued-message-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('queued-message-session-toggle')).toBeInTheDocument();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
  });
});
