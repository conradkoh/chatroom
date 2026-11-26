/**
 * ReorderableQueuedList — rendered list behaviour.
 *
 * The Convex session adapter is the only thing mocked: `useSessionMutation`
 * returns a `vi.fn()` this test controls. The list, the hook, the row and the
 * item are the real implementations.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReorderableQueuedList } from './ReorderableQueuedList';
import { QUEUED_DRAG_MIME } from '../../hooks/queuedReorderModel';
import type { Message } from '../../types/message';

import { FixedModal, FixedModalBody, FixedModalContent } from '@/components/ui/fixed-modal';

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

function dataTransfer(types: string[] = [QUEUED_DRAG_MIME]) {
  return {
    types,
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

/**
 * jsdom has no DragEvent, so `fireEvent.dragOver(el, { clientY })` loses
 * `clientY`. Build a MouseEvent (which carries clientY) and attach the stubbed
 * dataTransfer, matching what a real drag event looks like to React.
 */
function fireDrag(
  type: 'dragstart' | 'dragover' | 'dragleave' | 'drop',
  el: HTMLElement,
  transfer: ReturnType<typeof dataTransfer>,
  clientY = 0
): boolean {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return fireEvent(el, event);
}

function renderList(messages: Message[]) {
  return render(
    <ReorderableQueuedList chatroomId={CHATROOM_ID} messages={messages} enabled onDelete={noop} />
  );
}

function renderedOrder(): string[] {
  return Array.from(document.querySelectorAll('[data-queued-id]')).map(
    (el) => el.getAttribute('data-queued-id') ?? ''
  );
}

function liveRegion(): string {
  return screen.getByTestId('queued-reorder-live').textContent ?? '';
}

function mockRect(el: HTMLElement, height = 100) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: height,
    height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  sessionMutation.mockReset();
  sessionMutation.mockResolvedValue('ok');
  noop.mockClear();
});

describe('ReorderableQueuedList', () => {
  it('shows handles and a NEXT badge only with two or more rows', () => {
    const { rerender } = renderList([A, B]);

    expect(screen.getByTestId('queued-reorder-handle-a')).toBeInTheDocument();
    expect(screen.getByTestId('queued-reorder-handle-b')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.getByTestId('queued-reorder-live')).toBeInTheDocument();
    expect(screen.getByTestId('reorderable-queued-list')).toBeInTheDocument();

    rerender(
      <ReorderableQueuedList chatroomId={CHATROOM_ID} messages={[A]} enabled onDelete={noop} />
    );

    expect(screen.queryByTestId('queued-reorder-handle-a')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queued-reorder-live')).not.toBeInTheDocument();
    expect(screen.getByTestId('reorderable-queued-list')).toBeInTheDocument();
  });

  it('commits one keyboard move with the right intent and keeps focus on the handle', async () => {
    const user = userEvent.setup();
    renderList([A, B]);

    await user.tab();
    await user.tab();
    const handle = screen.getByTestId('queued-reorder-handle-a');
    expect(document.activeElement).toBe(handle);

    await user.keyboard(' ');
    expect(liveRegion()).toBe(
      'Picked up "Queued a", position 1 of 2. Arrow keys move, Space drops, Escape cancels.'
    );

    await user.keyboard('{ArrowDown}');
    expect(liveRegion()).toBe('Moved to position 2 of 2.');
    expect(renderedOrder()).toEqual(['b', 'a']);

    await user.keyboard(' ');

    expect(sessionMutation).toHaveBeenCalledTimes(1);
    expect(sessionMutation).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      movedId: 'a',
      afterId: 'b',
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('queued-reorder-handle-a'))
    );
  });

  it('cancels a lift with Escape without a write and restores the original slot', async () => {
    const user = userEvent.setup();
    renderList([A, B, C]);

    await user.click(screen.getByTestId('queued-reorder-handle-b'));
    await user.keyboard('{ArrowDown}');
    expect(renderedOrder()).toEqual(['a', 'c', 'b']);

    await user.keyboard('{Escape}');

    expect(sessionMutation).not.toHaveBeenCalled();
    expect(renderedOrder()).toEqual(['a', 'b', 'c']);
    expect(liveRegion()).toBe('Reorder cancelled.');
  });

  it('drops after another row with a drag and calls the write once', () => {
    renderList([A, B]);
    const transfer = dataTransfer();
    const handle = screen.getByTestId('queued-reorder-handle-a');
    const rowB = screen.getByTestId('queued-row-b');
    mockRect(rowB);

    const notPrevented = fireDrag('dragstart', handle, transfer);
    expect(notPrevented).toBe(true);
    expect(transfer.setData).toHaveBeenCalledWith(QUEUED_DRAG_MIME, 'a');

    fireDrag('dragover', rowB, transfer, 90);
    expect(screen.getByTestId('queued-row-b').className).toContain('before:bottom-0');
    fireDrag('dragover', rowB, transfer, 10);
    expect(screen.getByTestId('queued-row-b').className).not.toContain('before:bottom-0');
    fireDrag('dragover', rowB, transfer, 90);

    fireDrag('drop', rowB, transfer, 90);

    expect(sessionMutation).toHaveBeenCalledTimes(1);
    expect(sessionMutation).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      movedId: 'a',
      afterId: 'b',
    });
  });

  it('makes no write when dropping on the dragged row itself', () => {
    renderList([A, B]);
    const transfer = dataTransfer();
    const rowA = screen.getByTestId('queued-row-a');
    mockRect(rowA);

    fireDrag('dragstart', screen.getByTestId('queued-reorder-handle-a'), transfer);
    fireDrag('dragover', rowA, transfer, 90);

    expect(screen.getByTestId('queued-row-a').className).not.toContain('before:');

    fireDrag('drop', rowA, transfer, 90);

    expect(sessionMutation).not.toHaveBeenCalled();
  });

  it('ignores a foreign drag: no drop line and no preventDefault', () => {
    renderList([A, B]);
    const foreign = dataTransfer(['Files']);
    const rowB = screen.getByTestId('queued-row-b');
    mockRect(rowB);

    const notPrevented = fireDrag('dragover', rowB, foreign, 90);

    expect(notPrevented).toBe(true);
    expect(screen.getByTestId('queued-row-b').className).not.toContain('before:');
  });

  it('shows a dismissible warning when the write resolves stale', async () => {
    sessionMutation.mockResolvedValue('stale');
    const user = userEvent.setup();
    renderList([A, B]);

    await user.click(screen.getByTestId('queued-reorder-handle-a'));
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    expect(
      await screen.findByText('That message was already started or removed. Order refreshed.')
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dismiss'));

    expect(screen.queryByTestId('queued-reorder-feedback')).not.toBeInTheDocument();
  });

  it('shows an error when the write rejects', async () => {
    sessionMutation.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderList([A, B]);

    await user.click(screen.getByTestId('queued-reorder-handle-a'));
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    expect(
      await screen.findByText("Couldn't reorder queued messages. The order was restored.")
    ).toBeInTheDocument();
    expect(renderedOrder()).toEqual(['a', 'b']);
  });

  it('announces the drop', async () => {
    const user = userEvent.setup();
    renderList([A, B]);

    await user.click(screen.getByTestId('queued-reorder-handle-a'));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(liveRegion()).toBe('Moved to position 2 of 2.'));

    await user.keyboard(' ');
    await waitFor(() => expect(liveRegion()).toBe('Dropped at position 2 of 2.'));
  });

  it('keeps an enclosing FixedModal open when Escape cancels a lift', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <FixedModal isOpen onClose={onClose} maxWidth="max-w-xl">
        <FixedModalContent>
          <FixedModalBody className="p-0">
            <ReorderableQueuedList
              chatroomId={CHATROOM_ID}
              messages={[A, B]}
              enabled
              onDelete={noop}
              feedbackStickyTop
            />
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    );

    await user.click(screen.getByTestId('queued-reorder-handle-a'));
    expect(screen.getByTestId('queued-reorder-handle-a')).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('queued-reorder-handle-a')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(onClose).not.toHaveBeenCalled();

    // Proves the assertion above can fail: with no lift, Escape closes the modal.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
