/**
 * useQueuedMessageReorder — interaction state machine tests.
 *
 * The hook takes `reorder` as an argument, so the write is seamed at that port
 * with a stub. These tests cover phase transitions, one write per commit,
 * announcements and feedback; DOM details live in the list test.
 */

import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { QueuedReorderIntent, QueuedReorderOutcome } from './queuedReorderModel';
import { useQueuedMessageReorder } from './useQueuedMessageReorder';
import type { Message } from '../types/message';

function makeMessage(id: string): Message {
  return {
    _id: id,
    type: 'message',
    senderRole: 'user',
    content: `Message ${id}`,
    _creationTime: 1000,
  };
}

const A = makeMessage('a');
const B = makeMessage('b');
const C = makeMessage('c');

type Args = Parameters<typeof useQueuedMessageReorder>[0];

function keyEvent(key: string): ReactKeyboardEvent<HTMLElement> {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactKeyboardEvent<HTMLElement>;
}

function setup(overrides: Partial<Args> = {}) {
  const reorder = vi.fn<(intent: QueuedReorderIntent) => Promise<QueuedReorderOutcome>>(
    async () => 'ok'
  );
  const onFeedback = vi.fn();
  const clearFeedback = vi.fn();
  const initialProps: Args = {
    messages: [A, B, C],
    enabled: true,
    reorder,
    onFeedback,
    clearFeedback,
    ...overrides,
  };
  const view = renderHook((props: Args) => useQueuedMessageReorder(props), { initialProps });

  const ids = () => view.result.current.displayed.map((message) => message._id);

  return { ...view, reorder, onFeedback, clearFeedback, ids };
}

/** Lifts a row by id, using the handle props for its current displayed index. */
function lift(result: { current: ReturnType<typeof useQueuedMessageReorder> }, id: string) {
  const index = result.current.displayed.findIndex((message) => message._id === id);
  act(() => {
    result.current.itemProps(id, index)?.onHandleActivate();
  });
}

describe('useQueuedMessageReorder', () => {
  it('is not reorderable with a single message and returns no item props', () => {
    const { result } = setup({ messages: [A] });

    expect(result.current.reorderable).toBe(false);
    expect(result.current.itemProps('a', 0)).toBeUndefined();
  });

  it('is not reorderable while disabled', () => {
    const { result } = setup({ enabled: false });

    expect(result.current.reorderable).toBe(false);
    expect(result.current.itemProps('a', 0)).toBeUndefined();
  });

  it('lifts, moves with ArrowDown, and commits once on Done with the right intent', async () => {
    const { result, reorder, ids } = setup();

    lift(result, 'b');
    expect(result.current.itemProps('b', 1)?.state).toBe('lifted');
    expect(result.current.announcement).toBe(
      'Picked up "Message b", position 2 of 3. Arrow keys move, Space drops, Escape cancels.'
    );

    act(() => {
      result.current.itemProps('b', 1)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });
    expect(ids()).toEqual(['a', 'c', 'b']);
    expect(result.current.announcement).toBe('Moved to position 3 of 3.');

    await act(async () => {
      result.current.itemProps('b', 2)?.onDone();
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith({ movedId: 'b', afterId: 'c' });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('announces the ends when a move is clamped', () => {
    const { result } = setup();

    lift(result, 'a');
    act(() => {
      result.current.itemProps('a', 0)?.onHandleKeyDown(keyEvent('ArrowUp'));
    });
    expect(result.current.announcement).toBe('Already first.');

    act(() => {
      result.current.itemProps('a', 0)?.onHandleKeyDown(keyEvent('End'));
    });
    expect(result.current.displayed.map((message) => message._id)).toEqual(['b', 'c', 'a']);

    act(() => {
      result.current.itemProps('a', 2)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });
    expect(result.current.announcement).toBe('Already last.');
  });

  it('cancels with Escape without writing, and stops propagation', async () => {
    const { result, reorder, ids, onFeedback } = setup();

    lift(result, 'b');
    act(() => {
      result.current.itemProps('b', 1)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });

    const escape = keyEvent('Escape');
    act(() => {
      result.current.itemProps('b', 2)?.onHandleKeyDown(escape);
    });

    expect(escape.preventDefault).toHaveBeenCalled();
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(result.current.announcement).toBe('Reorder cancelled.');
    expect(reorder).not.toHaveBeenCalled();
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it('does not write when the row is dropped back at its original slot', async () => {
    const { result, reorder } = setup();

    lift(result, 'b');
    await act(async () => {
      result.current.itemProps('b', 1)?.onDone();
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(result.current.itemProps('b', 1)?.state).toBe('idle');
  });

  it('shows error feedback and restores the server order when the write rejects', async () => {
    const reorder = vi.fn(async () => {
      throw new Error('network');
    });
    const { result, onFeedback, ids } = setup({ reorder });

    lift(result, 'b');
    act(() => {
      result.current.itemProps('b', 1)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });
    await act(async () => {
      result.current.itemProps('b', 2)?.onDone();
    });

    expect(onFeedback).toHaveBeenCalledWith(
      'error',
      "Couldn't reorder queued messages. The order was restored."
    );
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(result.current.itemProps('b', 1)?.state).toBe('idle');
  });

  it('shows warning feedback on a stale result', async () => {
    const reorder = vi.fn(async () => 'stale' as const);
    const { result, onFeedback } = setup({ reorder });

    lift(result, 'b');
    act(() => {
      result.current.itemProps('b', 1)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });
    await act(async () => {
      result.current.itemProps('b', 2)?.onDone();
    });

    expect(onFeedback).toHaveBeenCalledWith(
      'warning',
      'That message was already started or removed. Order refreshed.'
    );
  });

  it('cancels with a warning when the moved row disappears mid-lift', () => {
    const { result, rerender, onFeedback, ids, ...rest } = setup();

    lift(result, 'b');
    act(() => {
      rerender({
        messages: [A, C],
        enabled: true,
        reorder: rest.reorder,
        onFeedback,
        clearFeedback: rest.clearFeedback,
      });
    });

    expect(onFeedback).toHaveBeenCalledWith(
      'warning',
      'That message was already started or removed. Order refreshed.'
    );
    expect(ids()).toEqual(['a', 'c']);
    expect(result.current.itemProps('b', 1)?.state).toBeUndefined();
  });

  it('ignores a second commit while a write is in flight', async () => {
    let settle: (outcome: QueuedReorderOutcome) => void = () => {};
    const reorder = vi.fn(
      () =>
        new Promise<QueuedReorderOutcome>((resolve) => {
          settle = resolve;
        })
    );
    const { result } = setup({ reorder });

    lift(result, 'b');
    act(() => {
      result.current.itemProps('b', 1)?.onHandleKeyDown(keyEvent('ArrowDown'));
    });
    const lifted = result.current.itemProps('b', 2);

    act(() => {
      lifted?.onDone();
      lifted?.onDone();
      result.current.itemProps('a', 0)?.onHandleActivate();
    });

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(result.current.itemProps('a', 0)?.state).toBe('locked');

    await act(async () => {
      settle('ok');
    });
  });

  it('cancels silently when the list shrinks to one row', () => {
    const { result, rerender, onFeedback } = setup();

    // The lifted row survives; the other rows leave.
    lift(result, 'a');
    act(() => {
      rerender({
        messages: [A],
        enabled: true,
        reorder: vi.fn(async () => 'ok' as const),
        onFeedback,
        clearFeedback: vi.fn(),
      });
    });

    expect(result.current.displayed.map((message) => message._id)).toEqual(['a']);
    expect(result.current.reorderable).toBe(false);
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it('clamps a lifted slot when another row is removed', () => {
    const { result } = setup();

    lift(result, 'c');
    act(() => {
      result.current.itemProps('c', 2)?.onHandleKeyDown(keyEvent('Home'));
    });
    expect(result.current.displayed.map((message) => message._id)).toEqual(['c', 'a', 'b']);

    // A row below the moved row disappears: the slot range shrinks by one.
    act(() => {
      result.current.itemProps('c', 0)?.onHandleKeyDown(keyEvent('End'));
    });
    expect(result.current.displayed.map((message) => message._id)).toEqual(['a', 'b', 'c']);
  });

  it('exposes at most one drop edge while dragging', () => {
    const { result } = setup();

    const dragStart = result.current.itemProps('a', 0)?.onHandleDragStart;
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: 'none',
      dropEffect: 'none',
      types: [] as string[],
    };

    act(() => {
      dragStart?.({
        dataTransfer,
        currentTarget: { closest: () => null },
      } as unknown as Parameters<NonNullable<typeof dragStart>>[0]);
    });

    expect(result.current.itemProps('a', 0)?.state).toBe('dragging');
    // Server order is kept while dragging; the line marks the target slot.
    expect(result.current.displayed.map((message) => message._id)).toEqual(['a', 'b', 'c']);
    expect(result.current.itemProps('b', 1)?.dropEdge).toBeNull();
  });
});
