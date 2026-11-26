/**
 * QueuedMessagesModal — the full queued list.
 *
 * Only the Convex session adapter is mocked (the same boundary the
 * ReorderableQueuedList test uses). The modal, the shared list, the hook and the
 * rows are the real implementations.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueuedMessagesModal } from './QueuedMessagesModal';
import type { Message } from '../../types/message';

const { sessionMutation } = vi.hoisted(() => ({ sessionMutation: vi.fn() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => [],
  useSessionMutation: () => sessionMutation,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      reorderQueuedMessage: 'messages:reorderQueuedMessage',
      updateQueuedMessageEnvelope: 'messages:updateQueuedMessageEnvelope',
      updateUserMessageOrTask: 'messages:updateUserMessageOrTask',
      deleteUserMessageOrTask: 'messages:deleteUserMessageOrTask',
    },
    tasks: {},
  },
}));

const CHATROOM_ID = 'chatroom-1' as Id<'chatroom_rooms'>;
const noop = vi.fn().mockResolvedValue(undefined);

function makeMessage(id: string): Message {
  return {
    _id: id,
    type: 'message',
    senderRole: 'user',
    content: `Queued ${id}`,
    _creationTime: Date.now(),
    isQueued: true,
  };
}

const A = makeMessage('a');
const B = makeMessage('b');
const C = makeMessage('c');

beforeEach(() => {
  sessionMutation.mockReset();
  sessionMutation.mockResolvedValue('ok');
  noop.mockClear();
});

describe('QueuedMessagesModal', () => {
  it('makes every row in the full list reorderable and stops the last row at the end', async () => {
    const user = userEvent.setup();
    render(
      <QueuedMessagesModal
        chatroomId={CHATROOM_ID}
        messages={[A, B, C]}
        onClose={vi.fn()}
        onDelete={noop}
      />
    );

    expect(screen.getByTestId('queued-reorder-handle-a')).toBeInTheDocument();
    expect(screen.getByTestId('queued-reorder-handle-b')).toBeInTheDocument();
    expect(screen.getByTestId('queued-reorder-handle-c')).toBeInTheDocument();

    await user.click(screen.getByTestId('queued-reorder-handle-c'));
    await user.keyboard('{ArrowDown}');

    const moveDown = screen.getByTestId('queued-move-down');
    expect(moveDown).toBeDisabled();
    expect(moveDown).toHaveAttribute('title', 'Already last');
    expect(sessionMutation).not.toHaveBeenCalled();
  });

  it('shows the empty state for no messages', () => {
    render(
      <QueuedMessagesModal
        chatroomId={CHATROOM_ID}
        messages={[]}
        onClose={vi.fn()}
        onDelete={noop}
      />
    );

    expect(screen.getByText('No queued messages')).toBeInTheDocument();
  });

  it('pins reorder feedback to the top while the list scrolls', async () => {
    sessionMutation.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(
      <QueuedMessagesModal
        chatroomId={CHATROOM_ID}
        messages={[A, B]}
        onClose={vi.fn()}
        onDelete={noop}
      />
    );

    await user.click(screen.getByTestId('queued-reorder-handle-a'));
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    const feedback = await screen.findByTestId('queued-reorder-feedback');
    expect(feedback.className).toContain('sticky');
    await waitFor(() =>
      expect(screen.getByTestId('queued-reorder-feedback')).toHaveTextContent(
        "Couldn't reorder queued messages. The order was restored."
      )
    );
  });

  it('renders no handles while disabled', () => {
    render(
      <QueuedMessagesModal
        chatroomId={CHATROOM_ID}
        messages={[A, B, C]}
        enabled={false}
        onClose={vi.fn()}
        onDelete={noop}
      />
    );

    expect(screen.getByText('Queued a')).toBeInTheDocument();
    expect(
      document.querySelector('[data-testid^="queued-reorder-handle-"]')
    ).not.toBeInTheDocument();
  });
});
