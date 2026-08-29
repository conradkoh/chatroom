import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAllTabConversation } from './useAllTabConversation';

const mockUsePaginatedQuery = vi.fn();
const mockUseSessionQuery = vi.fn();
const mockUseSessionId = vi.fn(() => ['session-1']);

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => mockUsePaginatedQuery(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => mockUseSessionId(),
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

vi.mock('../../../hooks/chatroomMessageStore', () => ({
  toMessage: (m: { _id: string }) => m,
}));

vi.mock('../../../timeline/mapMessageToTimelineEvent', () => ({
  mapMessageToTimelineEvent: (message: { _id: string }) => ({
    id: message._id,
    kind: 'user_message',
    creationTime: 100,
    message,
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    allTabConversation: {
      getAllTabAnchorNavigation: 'getAllTabAnchorNavigation',
      listAllTabSlicePaginated: 'listAllTabSlicePaginated',
      subscribeAllTabSliceTail: 'subscribeAllTabSliceTail',
    },
  },
}));

const baseResults = [
  { _id: 'msg-1', type: 'message', senderRole: 'user', content: 'hello', _creationTime: 100 },
  { _id: 'msg-2', type: 'message', senderRole: 'builder', content: 'reply', _creationTime: 101 },
];

const navResult = {
  anchor: { _id: 'anchor-1', _creationTime: 100, contentPreview: 'hello' },
  prevAnchorId: null,
  nextAnchorId: null,
  sliceUpperBoundExclusive: null,
};

function mockSessionQueryForNav(nav: unknown) {
  mockUseSessionQuery.mockImplementation((queryRef: string, args: unknown) => {
    if (queryRef === 'subscribeAllTabSliceTail') {
      if (args === 'skip') return undefined;
      return null;
    }
    return nav;
  });
}

describe('useAllTabConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionId.mockReturnValue(['session-1']);
    mockSessionQueryForNav(navResult);
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'Exhausted',
      loadMore: vi.fn(),
    });
  });

  it('loads navigation and paginated slice on mount', () => {
    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('getAllTabAnchorNavigation', {
      chatroomId: 'room-1',
    });
    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listAllTabSlicePaginated',
      {
        chatroomId: 'room-1',
        sessionId: 'session-1',
        anchorMessageId: 'anchor-1',
        sliceUpperBoundExclusive: null,
      },
      { initialNumItems: 50 }
    );
    expect(result.current.events).toHaveLength(2);
    expect(result.current.isOnLatestAnchor).toBe(true);
    expect(result.current.hasPrev).toBe(false);
    expect(result.current.hasNext).toBe(false);
  });

  it('is not loading when chatroom has no user messages (empty anchor)', () => {
    mockSessionQueryForNav({
      anchor: null,
      prevAnchorId: null,
      nextAnchorId: null,
      sliceUpperBoundExclusive: null,
    });
    mockUsePaginatedQuery.mockReturnValue({
      results: [],
      status: 'LoadingFirstPage',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.events).toHaveLength(0);
    expect(mockUsePaginatedQuery).toHaveBeenCalledWith('listAllTabSlicePaginated', 'skip', {
      initialNumItems: 50,
    });
  });

  it('skips queries when session is missing', () => {
    mockUseSessionId.mockReturnValue([undefined as unknown as string]);
    mockUseSessionQuery.mockReturnValue(undefined);
    mockUsePaginatedQuery.mockReturnValue({
      results: [],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });
    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('getAllTabAnchorNavigation', 'skip');
    expect(result.current.events).toHaveLength(0);
    expect(result.current.nav).toBeUndefined();
  });

  it('exposes nav state including prev/next and sliceUpperBoundExclusive', () => {
    mockSessionQueryForNav({
      anchor: { _id: 'anchor-mid', _creationTime: 150, contentPreview: 'middle' },
      prevAnchorId: 'anchor-old',
      nextAnchorId: 'anchor-new',
      sliceUpperBoundExclusive: 200,
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.hasPrev).toBe(true);
    expect(result.current.hasNext).toBe(true);
    // Initially selectedAnchorId is null, so user is on latest
    expect(result.current.isOnLatestAnchor).toBe(true);

    act(() => {
      result.current.goToPrev();
    });

    // After navigating, isOnLatestAnchor should be false
    expect(result.current.isOnLatestAnchor).toBe(false);
    expect(result.current.nav?.sliceUpperBoundExclusive).toBe(200);
    expect(mockUsePaginatedQuery).toHaveBeenLastCalledWith(
      'listAllTabSlicePaginated',
      {
        chatroomId: 'room-1',
        sessionId: 'session-1',
        anchorMessageId: 'anchor-mid',
        sliceUpperBoundExclusive: 200,
      },
      { initialNumItems: 50 }
    );
  });

  it('derives messages directly from paginated results (no reducer dispatch)', () => {
    const { result, rerender } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.events).toHaveLength(2);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]._id).toBe('msg-1');
    expect(result.current.messages[1]._id).toBe('msg-2');

    // When paginated.results updates, messages reflect the new results directly.
    mockUsePaginatedQuery.mockReturnValue({
      results: [
        {
          _id: 'msg-3',
          type: 'message',
          senderRole: 'user',
          content: 'third',
          _creationTime: 102,
        },
      ],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    rerender();

    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-3']);
  });

  it('skips the tail subscription until pagination is exhausted', () => {
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('subscribeAllTabSliceTail', 'skip');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2']);
  });

  it('subscribes to the tail when pagination is exhausted', () => {
    const { result } = renderHook(() => useAllTabConversation('room-1'));

    const tailCall = mockUseSessionQuery.mock.calls.find(
      (call) => call[0] === 'subscribeAllTabSliceTail'
    );
    expect(tailCall).toBeDefined();
    expect(tailCall![1]).toEqual({
      chatroomId: 'room-1',
      afterCreationTime: 101,
      upperBoundExclusive: null,
    });
    expect(result.current.messages).toHaveLength(2);
  });

  it('merges tail messages without duplicates when pagination is exhausted', () => {
    const tailMessages = [
      // Duplicate of an already-loaded paginated message (id-based dedup)
      { _id: 'msg-1', type: 'message', senderRole: 'user', content: 'hello', _creationTime: 100 },
      // New live message after the loaded slice
      {
        _id: 'msg-live',
        type: 'message',
        senderRole: 'builder',
        content: 'live',
        _creationTime: 150,
      },
    ];
    mockUseSessionQuery.mockImplementation((queryRef: string, args: unknown) => {
      if (queryRef === 'subscribeAllTabSliceTail') {
        if (args === 'skip') return 'skip';
        return tailMessages;
      }
      return navResult;
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2', 'msg-live']);
    expect(result.current.events).toHaveLength(3);
  });

  it('exposes pagination controls', () => {
    const loadMore = vi.fn();
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'CanLoadMore',
      loadMore,
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.isLoadingMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });

    expect(loadMore).toHaveBeenCalledWith(50);
  });

  it('isOnLatestAnchor is false when selectedAnchorId is set', () => {
    mockSessionQueryForNav({
      anchor: { _id: 'anchor-mid', _creationTime: 150, contentPreview: 'middle' },
      prevAnchorId: 'anchor-old',
      nextAnchorId: null,
      sliceUpperBoundExclusive: 200,
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    act(() => {
      result.current.goToPrev();
    });

    expect(result.current.isOnLatestAnchor).toBe(false);
  });

  it('goToLatestAnchor clears selected anchor so navigation uses latest', () => {
    mockSessionQueryForNav({
      anchor: { _id: 'anchor-mid', _creationTime: 150, contentPreview: 'middle' },
      prevAnchorId: 'anchor-old',
      nextAnchorId: 'anchor-new',
      sliceUpperBoundExclusive: 200,
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    act(() => {
      result.current.goToPrev();
    });

    const callsWithAnchor = mockUseSessionQuery.mock.calls.filter(
      (call) =>
        call[0] === 'getAllTabAnchorNavigation' &&
        call[1] !== 'skip' &&
        typeof call[1] === 'object' &&
        'anchorMessageId' in call[1]
    );
    expect(callsWithAnchor.length).toBeGreaterThan(0);

    act(() => {
      result.current.goToLatestAnchor();
    });

    const latestNavCall = mockUseSessionQuery.mock.calls
      .filter((call) => call[0] === 'getAllTabAnchorNavigation')
      .map((call) => call[1])
      .filter((args) => args !== 'skip')
      .at(-1);
    expect(latestNavCall).toEqual({ chatroomId: 'room-1' });
    expect(latestNavCall).not.toHaveProperty('anchorMessageId');
  });
});
