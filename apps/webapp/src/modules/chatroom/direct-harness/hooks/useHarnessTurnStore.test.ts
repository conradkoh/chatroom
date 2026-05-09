/**
 * Regression / unit tests for useHarnessTurnStore.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
let olderQueryCallCount = 0;
let tailQueryCallCount = 0;
let mockChunkData: Array<{ _id: string; _creationTime: number; seq?: number; content: string; partType?: 'text' | 'reasoning' }> = [];

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockQuery }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const a = args as Record<string, unknown>;
    if ('beforeTurnSeq' in a) {
      olderQueryCallCount++;
      return { turns: [], hasMore: true };
    }
    if ('messageId' in a) {
      // getStreamingTurnChunks — return configured mock data
      return mockChunkData;
    }
    // getTurnsSince — tail subscription
    tailQueryCallCount++;
    return [];
  },
  useSessionId: () => ['session-1'] as const,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    web: {
      directHarness: {
        turns: {
          getLatestTurns: 'getLatestTurns',
          getTurnsSince: 'getTurnsSince',
          getOlderTurns: 'getOlderTurns',
          getStreamingTurnChunks: 'getStreamingTurnChunks',
        },
      },
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTurn(id: string, turnSeq: number, role: 'user' | 'assistant' = 'user') {
  return {
    _id: id as never,
    turnSeq,
    role,
    status: 'complete' as const,
    textContent: `turn-${turnSeq}`,
    reasoningContent: '',
    startedAt: turnSeq * 1000,
  };
}

const HARNESS_SESSION_ID = 'hs1' as never;

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  olderQueryCallCount = 0;
  tailQueryCallCount = 0;
  mockChunkData = [];
});

import { useHarnessTurnStore } from './useHarnessTurnStore';

describe('useHarnessTurnStore — initial load', () => {
  it('initializes with turns from getLatestTurns', async () => {
    const initialTurns = [makeTurn('t1', 1), makeTurn('t2', 2), makeTurn('t3', 3)];

    mockQuery.mockResolvedValue({
      turns: initialTurns,
      hasMore: false,
      newestTurnSeq: 3,
    });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));

    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.turns).toHaveLength(3);
    expect(result.current.turns[0]!.turnSeq).toBe(1);
    expect(result.current.turns[2]!.turnSeq).toBe(3);
  });

  it('sets hasMoreOlder from the initial load result', async () => {
    mockQuery.mockResolvedValue({ turns: [makeTurn('t1', 10)], hasMore: true, newestTurnSeq: 10 });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));

    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);
  });
});

describe('useHarnessTurnStore — REQUEST_OLDER re-click regression', () => {
  it('processes a second loadOlderMessages call with the same oldestTurnSeq after first returns only duplicates', async () => {
    const initialTurns = [makeTurn('t10', 10), makeTurn('t11', 11), makeTurn('t12', 12)];

    mockQuery.mockResolvedValue({
      turns: initialTurns,
      hasMore: true,
      newestTurnSeq: 12,
    });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));

    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);

    // First click
    act(() => {
      result.current.loadOlderMessages();
    });

    await vi.waitFor(() => expect(result.current.isLoadingOlder).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);

    const countAfterFirst = olderQueryCallCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second click with same oldestTurnSeq
    act(() => {
      result.current.loadOlderMessages();
    });

    await vi.waitFor(() => expect(olderQueryCallCount).toBeGreaterThan(countAfterFirst));
  });
});

describe('useHarnessTurnStore — streamingOverlay', () => {
  it('returns null when no streaming turn exists', async () => {
    mockQuery.mockResolvedValue({ turns: [makeTurn('t1', 1)], hasMore: false, newestTurnSeq: 1 });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));

    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streamingOverlay).toBeNull();
  });
});

// Helper: make a streaming turn fixture
function makeStreamingTurn(id: string, turnSeq: number, messageId: string) {
  return {
    _id: id as never,
    turnSeq,
    role: 'assistant' as const,
    status: 'streaming' as const,
    messageId,
    textContent: '',
    reasoningContent: '',
    startedAt: turnSeq * 1000,
  };
}

describe('useHarnessTurnStore — streamingOverlay incremental accumulation', () => {
  it('builds overlay from initial chunks on first subscription', async () => {
    mockChunkData = [
      { _id: 'c1', _creationTime: 1000, content: 'hello ', partType: 'text' },
      { _id: 'c2', _creationTime: 1001, content: 'world', partType: 'text' },
    ];
    const streamTurn = makeStreamingTurn('t-stream', 1, 'msg-abc');
    mockQuery.mockResolvedValue({ turns: [streamTurn], hasMore: false, newestTurnSeq: 1 });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.streamingOverlay).not.toBeNull();
    expect(result.current.streamingOverlay!.textContent).toBe('hello world');
    expect(result.current.streamingOverlay!.reasoningContent).toBe('');
  });

  it('appends only new chunks past the high-water mark on subsequent updates', async () => {
    // Start with 2 chunks
    mockChunkData = [
      { _id: 'c1', _creationTime: 1000, content: 'hello ', partType: 'text' },
      { _id: 'c2', _creationTime: 1001, content: 'world', partType: 'text' },
    ];
    const streamTurn = makeStreamingTurn('t-stream', 1, 'msg-xyz');
    mockQuery.mockResolvedValue({ turns: [streamTurn], hasMore: false, newestTurnSeq: 1 });

    const { result, rerender } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streamingOverlay!.textContent).toBe('hello world');

    // Simulate a new chunk arriving — the query now returns 3 chunks
    mockChunkData = [
      { _id: 'c1', _creationTime: 1000, content: 'hello ', partType: 'text' },
      { _id: 'c2', _creationTime: 1001, content: 'world', partType: 'text' },
      { _id: 'c3', _creationTime: 1002, content: '!', partType: 'text' },
    ];
    rerender();

    await vi.waitFor(() =>
      expect(result.current.streamingOverlay!.textContent).toBe('hello world!')
    );
  });

  it('resets overlay when messageId changes (new turn)', async () => {
    // Render with a streaming turn using messageId='msg-first', one chunk
    mockChunkData = [{ _id: 'f1', _creationTime: 1000, content: 'first', partType: 'text' }];
    const turn1 = makeStreamingTurn('t-1', 1, 'msg-first');
    mockQuery.mockResolvedValue({ turns: [turn1], hasMore: false, newestTurnSeq: 1 });

    const { result } = renderHook(() => useHarnessTurnStore(HARNESS_SESSION_ID));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streamingOverlay!.textContent).toBe('first');

    // Render a fresh hook as if the user navigated to a new session
    // (new harnessSessionId resets all internal state including refs)
    mockChunkData = [{ _id: 's1', _creationTime: 1000, content: 'second', partType: 'text' }];
    const turn2 = makeStreamingTurn('t-2', 1, 'msg-second');
    mockQuery.mockResolvedValue({ turns: [turn2], hasMore: false, newestTurnSeq: 1 });

    const { result: result2 } = renderHook(() =>
      useHarnessTurnStore('hs-different-session' as never)
    );
    await vi.waitFor(() => expect(result2.current.isLoading).toBe(false));

    // The new session's overlay should only contain 'second', not 'first'
    expect(result2.current.streamingOverlay!.textContent).toBe('second');
    expect(result2.current.streamingOverlay!.textContent).not.toContain('first');
  });
});
