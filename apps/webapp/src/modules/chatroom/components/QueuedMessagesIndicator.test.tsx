/**
 * QueuedMessagesIndicator — Unit Tests
 *
 * Verifies:
 * - Returns null when no queued messages.
 * - Renders the LAST message content (most recently queued).
 * - Shows (+N more) badge when more than one message is queued.
 * - Does NOT show (+N more) when exactly 1 message is queued.
 * - Clicking the indicator opens the detail modal.
 * - Mobile touch target: rendered element height ≥ 36px.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

import { QueuedMessagesIndicator } from './QueuedMessagesIndicator';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Control the list of queued messages returned by the query.
let mockQueuedMessages: { _id: string; _creationTime: number; content: string; senderRole: string }[] = [];

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, _args: unknown) => mockQueuedMessages,
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      listQueued: 'messages:listQueued',
      deleteQueuedMessage: 'messages:deleteQueuedMessage',
      updateQueuedMessage: 'messages:updateQueuedMessage',
    },
    tasks: {
      promoteSpecificTask: 'tasks:promoteSpecificTask',
    },
  },
}));

// Mock the detail modal — we just want to assert it opens, not test its internals.
vi.mock('./WorkQueue/QueuedMessageDetailModal', () => ({
  QueuedMessageDetailModal: ({
    isOpen,
    message,
  }: {
    isOpen: boolean;
    message: { content: string };
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Queued Message Modal">
        {message.content}
      </div>
    ) : null,
}));

const CHATROOM_ID = 'room-test-1';

function makeMessage(id: string, content: string, creationTime: number) {
  return { _id: id, _creationTime: creationTime, content, senderRole: 'user' };
}

function renderIndicator() {
  return render(<QueuedMessagesIndicator chatroomId={CHATROOM_ID} />);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQueuedMessages = [];
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueuedMessagesIndicator', () => {
  it('returns null when there are no queued messages', () => {
    mockQueuedMessages = [];
    const { container } = renderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('renders the last (most recently queued) message content', () => {
    mockQueuedMessages = [
      makeMessage('msg-1', 'first message', 1000),
      makeMessage('msg-2', 'second message', 2000),
      makeMessage('msg-3', 'last message content here', 3000),
    ];
    renderIndicator();
    expect(screen.getByText('last message content here')).toBeInTheDocument();
  });

  it('does NOT show (+N more) when exactly 1 message is queued', () => {
    mockQueuedMessages = [makeMessage('msg-1', 'only message', 1000)];
    renderIndicator();
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
  });

  it('shows (+1 more) when 2 messages are queued', () => {
    mockQueuedMessages = [
      makeMessage('msg-1', 'first message', 1000),
      makeMessage('msg-2', 'second message', 2000),
    ];
    renderIndicator();
    expect(screen.getByText('(+1 more)')).toBeInTheDocument();
  });

  it('shows (+N more) correctly for 4 queued messages', () => {
    mockQueuedMessages = [
      makeMessage('msg-1', 'msg 1', 1000),
      makeMessage('msg-2', 'msg 2', 2000),
      makeMessage('msg-3', 'msg 3', 3000),
      makeMessage('msg-4', 'last msg', 4000),
    ];
    renderIndicator();
    expect(screen.getByText('(+3 more)')).toBeInTheDocument();
    expect(screen.getByText('last msg')).toBeInTheDocument();
  });

  it('clicking the indicator opens the detail modal for the last message', () => {
    mockQueuedMessages = [
      makeMessage('msg-1', 'earlier message', 1000),
      makeMessage('msg-2', 'latest queued message', 2000),
    ];
    renderIndicator();

    // Modal should not be open initially
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click the indicator
    const indicator = screen.getByRole('button');
    act(() => {
      fireEvent.click(indicator);
    });

    // Modal should now be open and show the LAST message's content
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('latest queued message');
  });

  it('keyboard Enter on indicator opens the modal', () => {
    mockQueuedMessages = [makeMessage('msg-1', 'keyboard test message', 1000)];
    renderIndicator();

    const indicator = screen.getByRole('button');
    act(() => {
      fireEvent.keyDown(indicator, { key: 'Enter' });
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has a minimum tap-target height of 36px (mobile-friendly)', () => {
    mockQueuedMessages = [makeMessage('msg-1', 'tap target test', 1000)];
    renderIndicator();

    const indicator = screen.getByRole('button');
    // min-h-9 = 36px in Tailwind — verify class is present
    expect(indicator.className).toContain('min-h-9');
  });

  it('disappears when all queued messages are removed', () => {
    // A fresh render with empty messages should return null.
    mockQueuedMessages = [];
    const { container } = renderIndicator();
    expect(container.firstChild).toBeNull();

    // And a render with messages shows the indicator.
    mockQueuedMessages = [makeMessage('msg-1', 'visible message', 1000)];
    const { container: container2 } = renderIndicator();
    expect(container2.firstChild).not.toBeNull();
  });
});
