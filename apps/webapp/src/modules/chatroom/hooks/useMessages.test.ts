/**
 * Unit tests for useMessages hook.
 *
 * Mocks usePaginatedQuery (via useSessionPaginatedQuery) and useSessionQuery
 * to test the merge/dedup/enrichment logic without a live Convex backend.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Configurable state for the paginated query mock
let mockPaginatedStatus: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted' =
  'Exhausted';
let mockPaginatedResults: Array<Record<string, unknown>> = [];
const mockLoadMore = vi.fn();

// Configurable state for the tail / activeTasks subscriptions
let mockTailData: Array<Record<string, unknown>> | undefined = [];
let mockActiveTasks: Array<{ _id: string; status: string }> | undefined = [];

vi.mock('../../../lib/useSessionPaginatedQuery', () => ({
  useSessionPaginatedQuery: (_query: unknown, _args: unknown, _options: unknown) => ({
    status: mockPaginatedStatus,
    results: mockPaginatedResults,
    loadMore: mockLoadMore,
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const a = args as Record<string, unknown>;
    if ('sinceCreationTime' in a) return mockTailData;
    if ('statusFilter' in a) return mockActiveTasks;
    return undefined;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messageList: {
      listMessages: 'listMessages',
      subscribeNewMessages: 'subscribeNewMessages',
    },
    tasks: {
      listTasks: 'listTasks',
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

// Import after mocks are set up
import { useMessages } from './useMessages';

describe('useMessages', () => {
  beforeEach(() => {
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = [];
    mockTailData = [];
    mockActiveTasks = [];
    mockLoadMore.mockClear();
  });

  // ── Loading state ──────────────────────────────────────────────────────

  it('isLoading=true when status is LoadingFirstPage', () => {
    mockPaginatedStatus = 'LoadingFirstPage';
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoading).toBe(true);
  });

  it('isLoading=false when status is Exhausted', () => {
    mockPaginatedStatus = 'Exhausted';
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoading).toBe(false);
  });

  it('hasMoreOlder=true when status is CanLoadMore', () => {
    mockPaginatedStatus = 'CanLoadMore';
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.hasMoreOlder).toBe(true);
  });

  it('isLoadingOlder=true when status is LoadingMore', () => {
    mockPaginatedStatus = 'LoadingMore';
    const { result } = renderHook(() => useMessages('room-1'));
    expect(result.current.isLoadingOlder).toBe(true);
  });

  // ── Empty chatroom → first message via tail ────────────────────────────

  it('empty chatroom: first message from tail appears in messages', () => {
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = []; // no historical
    const firstMessage = makeMsg('msg-1', 1_000_000);
    mockTailData = [firstMessage];

    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!._id).toBe('msg-1');
  });

  // ── Historical + tail merge ───────────────────────────────────────────

  it('merges historical (reversed to ASC) + tail in chronological order', () => {
    // Paginated returns DESC (newest first per page)
    mockPaginatedResults = [makeMsg('msg-3', 3000), makeMsg('msg-2', 2000), makeMsg('msg-1', 1000)];
    mockPaginatedStatus = 'Exhausted';
    // Tail has a newer message
    mockTailData = [makeMsg('msg-4', 4000)];

    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4']);
  });

  // ── Deduplication ─────────────────────────────────────────────────────

  it('deduplicates message that appears in both historical and tail', () => {
    mockPaginatedResults = [makeMsg('msg-3', 3000), makeMsg('msg-2', 2000)];
    mockPaginatedStatus = 'Exhausted';
    // tail includes msg-3 (already in historical) and a new msg-4
    mockTailData = [makeMsg('msg-3', 3000), makeMsg('msg-4', 4000)];

    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-2', 'msg-3', 'msg-4']);
  });

  // ── loadOlderMessages ─────────────────────────────────────────────────

  it('loadOlderMessages calls paginated.loadMore(20)', () => {
    const { result } = renderHook(() => useMessages('room-1'));
    result.current.loadOlderMessages();
    expect(mockLoadMore).toHaveBeenCalledWith(20);
  });

  // ── purgeOldMessages is a no-op ──────────────────────────────────────

  it('purgeOldMessages is a no-op (does not throw)', () => {
    const { result } = renderHook(() => useMessages('room-1'));
    expect(() => result.current.purgeOldMessages(50)).not.toThrow();
  });

  // ── Task-status via paginated source (no overlay) ─────────────────────

  it('reflects paginated taskStatus over overlay when values diverge', () => {
    mockPaginatedStatus = 'Exhausted';
    // Overlay has stale 'in_progress' but paginated says 'completed'
    mockActiveTasks = [{ _id: 'task-1', status: 'in_progress' }];
    mockPaginatedResults = [makeMsg('msg-1', 1000, { taskId: 'task-1', taskStatus: 'completed' })];

    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages[0]!.taskStatus).toBe('completed');
  });

  // ── Task-status via tail source (no overlay) ──────────────────────────

  it('reflects tail taskStatus over overlay when values diverge', () => {
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = [];
    // Overlay has stale 'in_progress' but tail says 'completed'
    mockActiveTasks = [{ _id: 'task-1', status: 'in_progress' }];
    mockTailData = [makeMsg('msg-tail', 2000, { taskId: 'task-1', taskStatus: 'completed' })];

    const { result } = renderHook(() => useMessages('room-1'));

    expect(result.current.messages[0]!.taskStatus).toBe('completed');
  });

  // ── Task deletion — no completed stamp ────────────────────────────────

  it('does not stamp completed when task is deleted (paginated re-emits without taskStatus)', () => {
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = [makeMsg('msg-1', 1000, { taskId: 'task-1', taskStatus: 'pending' })];
    // Task is active — overlay tracks it
    mockActiveTasks = [{ _id: 'task-1', status: 'in_progress' }];

    const { result, rerender } = renderHook(() => useMessages('room-1'));

    // Initial state: paginated data has pending status (no overlay)
    expect(result.current.messages[0]!.taskStatus).toBe('pending');

    // Task deleted: leaves active set AND paginated data drops taskStatus
    mockActiveTasks = [];
    mockPaginatedResults = [
      makeMsg('msg-1', 1000, { taskId: 'task-1' }), // no taskStatus
    ];
    rerender();

    // Post-simplification: paginated taskStatus is undefined (task deleted)
    // Currently fails: overlay stamps 'completed' because task left active set
    expect(result.current.messages[0]!.taskStatus).toBeUndefined();
  });

  // ── Tail is skipped while LoadingFirstPage ────────────────────────────

  it('tail subscription is skipped while status is LoadingFirstPage', () => {
    mockPaginatedStatus = 'LoadingFirstPage';
    mockTailData = [makeMsg('msg-early', 500)]; // should not appear

    const { result } = renderHook(() => useMessages('room-1'));

    // Because tail is 'skip', only historical (empty) should appear
    expect(result.current.messages).toHaveLength(0);
  });
});

describe('useMessages — empty-chatroom first-message regression', () => {
  // This is the core regression: when a chatroom has no messages and the
  // user sends the first one, it must appear immediately via the tail subscription.
  // This test locks down the scenario that prompted the full pagination overhaul.

  beforeEach(() => {
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = [];
    mockTailData = [];
    mockActiveTasks = [];

    mockLoadMore.mockClear();
  });

  it('empty chatroom: tail picks up first message once paginated finishes loading', () => {
    // Simulate: no historical messages, status=Exhausted (done loading empty chatroom)
    mockPaginatedStatus = 'Exhausted';
    mockPaginatedResults = [];
    // Tail returns the first message (sinceCreationTime=0 since no historical)
    mockTailData = [makeMsg('first-msg', 1_700_000_000_001)];

    const { result } = renderHook(() => useMessages('chatroom-1'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!._id).toBe('first-msg');
    expect(result.current.messages[0]!._creationTime).toBe(1_700_000_000_001);
  });

  it('tail is skipped (no double-subscription) while historical is still loading', () => {
    // During LoadingFirstPage, sinceCreationTime would be undefined/0 and the
    // tail would subscribe with sinceCreationTime=0, returning all messages.
    // We gate the tail on status !== 'LoadingFirstPage' to prevent this.
    mockPaginatedStatus = 'LoadingFirstPage';
    mockPaginatedResults = [];
    mockTailData = [makeMsg('premature-msg', 500)];

    const { result } = renderHook(() => useMessages('chatroom-2'));

    // Tail is 'skip' — no messages should appear
    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toHaveLength(0);
  });
});
