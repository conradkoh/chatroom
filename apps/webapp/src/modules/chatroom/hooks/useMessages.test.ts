/**
 * Unit tests for useChatroomMessageStore / useMessages.
 *
 * Mocks imperative getLatestMessages + listMessagesBefore, and the reactive
 * subscribeNewMessages / subscribeVisibleMessageUpdates subscriptions (the
 * mocked useSessionQuery returns mockTailData for any reactive query).
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Tests ────────────────────────────────────────────────────────────────────

import { useMessages } from './useMessages';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockTailData: Record<string, unknown>[] | undefined = [];
const mockConvexQuery = vi.fn();

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockConvexQuery }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mockTailData;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messageList: {
      getLatestMessages: 'getLatestMessages',
      subscribeNewMessages: 'subscribeNewMessages',
      subscribeVisibleMessageUpdates: 'subscribeVisibleMessageUpdates',
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

function mockInitialLoad(messages: Record<string, unknown>[], hasMore = false) {
  const sorted = [...messages].sort(
    (a, b) => (a._creationTime as number) - (b._creationTime as number)
  );
  const tailAfterCreationTime = sorted[0]?._creationTime ?? 0;
  mockConvexQuery.mockImplementation((endpoint: string) => {
    if (endpoint === 'getLatestMessages') {
      return Promise.resolve({ messages: sorted, hasMore, tailAfterCreationTime });
    }
    if (endpoint === 'listMessagesBefore') {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
}

describe('useMessages (delta store)', () => {
  beforeEach(() => {
    mockTailData = [];
    mockConvexQuery.mockReset();
    mockInitialLoad([]);
  });

  it('isLoading=true until initial getLatestMessages resolves', () => {
    mockConvexQuery.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading=false after initial load', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000)]);
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
  });

  it('hasMoreOlder=true when initial load reports hasMore', async () => {
    mockInitialLoad(
      Array.from({ length: 20 }, (_, i) => makeMsg(`msg-${i}`, i * 1000)),
      true
    );
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(true));
  });

  it('hasMoreOlder=true when initial window is full even if hasMore is false', async () => {
    mockInitialLoad(
      Array.from({ length: 20 }, (_, i) => makeMsg(`msg-${i}`, i * 1000)),
      false
    );
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(true));
  });

  it('hasMoreOlder=false when initial window is below cap', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000)], false);
    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.hasMoreOlder).toBe(false));
  });

  it('merges new messages from tail subscription without full-window refetch', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)]);
    mockTailData = [makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)];

    const { result, rerender } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    mockTailData = [makeMsg('msg-1', 1000), makeMsg('msg-2', 2000), makeMsg('msg-3', 3000)];
    rerender();

    await waitFor(() => {
      expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  it('updates existing row when tail subscription replaces taskStatus', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000, { taskStatus: 'pending' })]);
    const { result, rerender } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.messages[0]?.taskStatus).toBe('pending'));

    mockTailData = [makeMsg('msg-1', 1000, { taskStatus: 'in_progress' })];
    rerender();

    await waitFor(() => {
      expect(result.current.messages[0]?.taskStatus).toBe('in_progress');
    });
  });

  it('loadOlderMessages calls listMessagesBefore with oldest creation time', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)], true);
    mockConvexQuery.mockImplementation((endpoint: string) => {
      if (endpoint === 'getLatestMessages') {
        return Promise.resolve({
          messages: [makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)],
          hasMore: true,
          tailAfterCreationTime: 1000,
        });
      }
      if (endpoint === 'listMessagesBefore') {
        return Promise.resolve([makeMsg('msg-0', 500)]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

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
      expect(result.current.messages.map((m) => m._id)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    });
  });

  it('issues a second listMessagesBefore after a duplicate-only page', async () => {
    mockInitialLoad([makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)], true);
    const beforeArgs: number[] = [];
    mockConvexQuery.mockImplementation((endpoint: string, args?: { before?: number }) => {
      if (endpoint === 'getLatestMessages') {
        return Promise.resolve({
          messages: [makeMsg('msg-1', 1000), makeMsg('msg-2', 2000)],
          hasMore: true,
          tailAfterCreationTime: 1000,
        });
      }
      if (endpoint === 'listMessagesBefore') {
        beforeArgs.push(args?.before ?? -1);
        if (beforeArgs.length <= 2) {
          return Promise.resolve([makeMsg('msg-1', 1000)]);
        }
        return Promise.resolve([makeMsg('older-0', 500)]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.loadOlderMessages();
    });
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(false));
    const callsAfterFirst = beforeArgs.length;

    await act(async () => {
      result.current.loadOlderMessages();
    });
    await waitFor(() => {
      expect(beforeArgs.length).toBeGreaterThan(callsAfterFirst);
      expect(result.current.messages.some((m) => m._id === 'older-0')).toBe(true);
    });
  });

  it('keeps hasMoreOlder true after a partial older page (fewer than page size)', async () => {
    mockInitialLoad(
      Array.from({ length: 20 }, (_, i) => makeMsg(`msg-${i}`, i * 1000)),
      true
    );
    mockConvexQuery.mockImplementation((endpoint: string) => {
      if (endpoint === 'getLatestMessages') {
        const messages = Array.from({ length: 20 }, (_, i) => makeMsg(`msg-${i}`, i * 1000));
        return Promise.resolve({
          messages,
          hasMore: true,
          tailAfterCreationTime: 0,
        });
      }
      if (endpoint === 'listMessagesBefore') {
        return Promise.resolve([makeMsg('older-0', 50)]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useMessages('room-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);

    await act(async () => {
      result.current.loadOlderMessages();
    });

    await waitFor(() => {
      expect(result.current.messages.some((m) => m._id === 'older-0')).toBe(true);
      expect(result.current.hasMoreOlder).toBe(true);
    });
  });

  it('resets store when chatroomId changes', async () => {
    mockInitialLoad([makeMsg('a-1', 1000)]);
    const { result, rerender } = renderHook(({ roomId }) => useMessages(roomId), {
      initialProps: { roomId: 'room-1' },
    });
    await waitFor(() => expect(result.current.messages[0]?._id).toBe('a-1'));

    mockInitialLoad([makeMsg('b-1', 2000)]);
    rerender({ roomId: 'room-2' });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?._id).toBe('b-1');
    });
  });
});
