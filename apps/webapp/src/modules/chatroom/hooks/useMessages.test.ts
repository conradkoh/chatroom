/**
 * Unit tests for useMessages hook.
 *
 * Mocks useSessionQuery, useConvex, and useSessionId to test merge/dedup
 * and load-older behavior without a live Convex backend.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockSubscriptionData: Array<Record<string, unknown>> | undefined = [];
const mockConvexQuery = vi.fn();

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockConvexQuery }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionQuery: (_query: unknown, _args: unknown) => mockSubscriptionData,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messageList: {
      subscribeLatestMessages: 'subscribeLatestMessages',
      listMessagesBefore: 'listMessagesBefore',
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(
  id: string,
  creationTime: number,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    _id: id,
    _creationTime: creationTime,
    type: 'message',
    senderRole: 'user',
    content: `Message ${id}`,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

import { useMessages } from './useMessages';

describe('useMessages', () => {
  beforeEach(() => {
    mockSubscriptionData = [];
    mockConvexQuery.mockReset();
    mockConvexQuery.mockResolvedValue([]);
  });

  it('isLoading=true while subscription is undefined', () => {
    mockSubscriptionData = undefined;
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading=false once subscription resolves', () => {
    mockSubscriptionData = [];
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoading).toBe(false);
  });

  it('hasMoreOlder=true when subscription is at cap (20)', () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.hasMoreOlder).toBe(true);
  });

  it('hasMoreOlder=false when subscription below cap and no older pages', () => {
    mockSubscriptionData = [makeMsg('msg-1', 1000)];
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.hasMoreOlder).toBe(false);
  });

  it('empty chatroom: first message from subscription appears immediately', () => {
    mockSubscriptionData = [makeMsg('msg-1', 1_000_000)];
    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!._id).toBe('msg-1');
  });

  it('subscription messages are returned in chronological order', () => {
    mockSubscriptionData = [
      makeMsg('msg-1', 1000),
      makeMsg('msg-2', 2000),
      makeMsg('msg-3', 3000),
    ];
    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('retains messages that slide out of the subscription window', async () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    const { result, rerender } = renderHook(() => useMessages('room-1'));
    expect(result.current.messages).toHaveLength(20);

    mockSubscriptionData = [
      ...Array.from({ length: 19 }, (_, i) => makeMsg(`msg-${i + 1}`, (i + 1) * 1000)),
      makeMsg('msg-20', 20_000),
    ];
    rerender();

    await waitFor(() => {
      const ids = result.current.messages.map((m) => m._id);
      expect(ids).toContain('msg-0');
      expect(ids).toHaveLength(21);
    });
  });

  it('deduplicates message that appears in both older pages and subscription', async () => {
    mockSubscriptionData = [
      makeMsg('msg-2', 2000),
      makeMsg('msg-3', 3000),
      makeMsg('msg-4', 4000),
    ];
    mockConvexQuery.mockResolvedValue([makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)]);

    const { result } = renderHook(() => useMessages('room-1'));

    await act(async () => {
      result.current.loadOlderMessages();
    });

    await waitFor(() => {
      expect(result.current.messages.map((m) => m._id)).toEqual([
        'msg-1',
        'msg-2',
        'msg-3',
        'msg-4',
      ]);
    });
  });

  it('loadOlderMessages calls listMessagesBefore with oldest creation time', async () => {
    mockSubscriptionData = [makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)];
    mockConvexQuery.mockResolvedValue([makeMsg('msg-0', 500)]);

    const { result } = renderHook(() => useMessages('room-1'));

    await act(async () => {
      result.current.loadOlderMessages();
    });

    await waitFor(() => {
      expect(mockConvexQuery).toHaveBeenCalledWith('listMessagesBefore', {
        chatroomId: 'room-1',
        before: 1000,
        limit: 20,
        sessionId: 'session-1',
      });
    });
  });

  it('sets hasMoreOlder=false when loadOlder returns no messages', async () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    mockConvexQuery.mockResolvedValue([]);

    const { result } = renderHook(() => useMessages('room-1'));

    await act(async () => {
      result.current.loadOlderMessages();
    });

    await waitFor(() => {
      expect(result.current.hasMoreOlder).toBe(false);
    });
  });

  it('isLoadingOlder=true while loadOlder is in flight', async () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    let resolveQuery: (value: unknown[]) => void = () => {};
    mockConvexQuery.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        })
    );

    const { result } = renderHook(() => useMessages('room-1'));

    act(() => {
      result.current.loadOlderMessages();
    });

    expect(result.current.isLoadingOlder).toBe(true);

    await act(async () => {
      resolveQuery([]);
    });

    await waitFor(() => {
      expect(result.current.isLoadingOlder).toBe(false);
    });
  });

  it('reflects taskStatus from subscription data', () => {
    mockSubscriptionData = [
      makeMsg('msg-1', 1000, { taskId: 'task-1', taskStatus: 'completed' }),
    ];
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.messages[0]!.taskStatus).toBe('completed');
  });

  it('purgeOldMessages trims prepended history above the viewport buffer', async () => {
    const olderPage = Array.from({ length: 60 }, (_, i) => makeMsg(`old-${i}`, i * 1000));
    const liveWindow = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`live-${i}`, 100_000 + i * 1000)
    );
    mockSubscriptionData = liveWindow;

    const { result } = renderHook(() => useMessages('room-1'));

    await act(async () => {
      mockConvexQuery.mockResolvedValue(olderPage);
      result.current.loadOlderMessages();
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(80);
    });

    act(() => {
      result.current.purgeOldMessages(55);
    });

    await waitFor(() => {
      // keepFromIndex = 55 - 20 = 35 → drop 35 oldest prepended rows
      expect(result.current.messages.length).toBe(45);
      expect(result.current.messages[0]!._id).toBe('old-35');
      expect(result.current.messages.at(-1)!._id).toBe('live-19');
    });
  });

  it('purgeOldMessages is a no-op when viewport is near the top', () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    const { result } = renderHook(() => useMessages('room-1'));

    act(() => {
      result.current.purgeOldMessages(10);
    });

    expect(result.current.messages).toHaveLength(20);
  });

  it('purgeOldMessages clears exhaustedOlder so history can be loaded again', async () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`live-${i}`, 20_000 + i * 1000)
    );
    const olderPage = Array.from({ length: 40 }, (_, i) => makeMsg(`old-${i}`, i * 1000));
    mockConvexQuery.mockResolvedValueOnce(olderPage).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useMessages('room-1'));

    await act(async () => {
      result.current.loadOlderMessages();
    });
    await waitFor(() => {
      expect(result.current.messages.length).toBe(60);
    });

    await act(async () => {
      result.current.loadOlderMessages();
    });
    await waitFor(() => {
      expect(result.current.hasMoreOlder).toBe(false);
    });

    act(() => {
      result.current.purgeOldMessages(55);
    });

    expect(result.current.hasMoreOlder).toBe(true);
  });

  it('resets local pagination state when chatroomId changes', async () => {
    mockSubscriptionData = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`msg-${i}`, i * 1000)
    );
    mockConvexQuery.mockResolvedValue([makeMsg('old-0', 500)]);

    const { result, rerender } = renderHook(({ roomId }) => useMessages(roomId), {
      initialProps: { roomId: 'room-1' },
    });

    await act(async () => {
      result.current.loadOlderMessages();
    });
    await waitFor(() => {
      expect(result.current.messages.length).toBe(21);
    });

    rerender({ roomId: 'room-2' });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(20);
      expect(result.current.messages.every((m) => m._id.startsWith('msg-'))).toBe(true);
      expect(result.current.hasMoreOlder).toBe(true);
    });
  });
});

describe('useMessages — empty-chatroom first-message regression', () => {
  beforeEach(() => {
    mockSubscriptionData = [];
    mockConvexQuery.mockReset();
  });

  it('empty chatroom: subscription picks up first message once resolved', () => {
    mockSubscriptionData = [makeMsg('first-msg', 1_700_000_000_001)];

    const { result } = renderHook(() => useMessages('chatroom-1'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!._id).toBe('first-msg');
  });

  it('isLoading=true while subscription has not resolved (no premature messages)', () => {
    mockSubscriptionData = undefined;

    const { result } = renderHook(() => useMessages('chatroom-2'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toHaveLength(0);
  });
});
