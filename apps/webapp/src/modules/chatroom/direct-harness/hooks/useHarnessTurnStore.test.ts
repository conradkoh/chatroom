/**
 * Regression / unit tests for useHarnessTurnStore.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
let olderQueryCallCount = 0;
let tailQueryCallCount = 0;

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
      // getStreamingTurnChunks — return empty
      return [];
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
