/**
 * Regression tests for useHarnessMessageStore.
 *
 * Focuses on the bug where re-clicking "Load older messages" with an unchanged
 * oldestSeq was silently suppressed by the processedOlderSeqRef guard.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
// Tracks how many times the older query was activated (args include beforeSeq).
let olderQueryCallCount = 0;

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockQuery }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_api: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const a = args as Record<string, unknown>;
    if ('beforeSeq' in a) {
      olderQueryCallCount++;
      // Return empty messages (all would be duplicates) but hasMore=true.
      return { messages: [], hasMore: true };
    }
    // Tail subscription — empty.
    return [];
  },
  useSessionId: () => ['session-1'] as const,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    web: {
      directHarness: {
        messages: {
          getLatestMessages: 'getLatestMessages',
          getMessagesSince: 'getMessagesSince',
          getOlderMessages: 'getOlderMessages',
        },
      },
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(id: string, seq: number) {
  return {
    _id: id as never,
    seq,
    role: 'user' as const,
    content: `msg-${seq}`,
    timestamp: seq * 1000,
    harnessSessionId: 'hs1' as never,
  };
}

const HARNESS_SESSION_ID = 'hs1' as never;

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  olderQueryCallCount = 0;
});

import { useHarnessMessageStore } from './useHarnessMessageStore';

describe('useHarnessMessageStore — re-click "Load older" regression', () => {
  it('processes a second loadOlderMessages call with the same oldestSeq after the first returns only duplicates', async () => {
    const initialMessages = [
      makeMessage('m10', 10),
      makeMessage('m11', 11),
      makeMessage('m12', 12),
    ];

    mockQuery.mockResolvedValue({
      messages: initialMessages,
      newestSeq: 12,
      hasMore: true,
    });

    const { result } = renderHook(() => useHarnessMessageStore(HARNESS_SESSION_ID));

    // Wait for initialization.
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);

    // First click — triggers REQUEST_OLDER. The mock's older query returns empty
    // (all duplicates), so PREPEND_OLDER fires but oldestSeq stays at 10.
    act(() => {
      result.current.loadOlderMessages();
    });

    // After PREPEND_OLDER, isLoadingOlder resets to false.
    await vi.waitFor(() => expect(result.current.isLoadingOlder).toBe(false));
    expect(result.current.hasMoreOlder).toBe(true);

    const countAfterFirst = olderQueryCallCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second click with the same oldestSeq (10). Before the fix, processedOlderSeqRef
    // still held 10 → the effect guard silently suppressed the call. After the fix,
    // processedOlderSeqRef is null → the effect processes the second request.
    act(() => {
      result.current.loadOlderMessages();
    });

    // The older query mock must have been called again, proving the request
    // was processed rather than suppressed.
    await vi.waitFor(() => expect(olderQueryCallCount).toBeGreaterThan(countAfterFirst));
  });
});
