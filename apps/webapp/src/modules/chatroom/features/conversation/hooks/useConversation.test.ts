import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversation } from './useConversation';

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

vi.mock('../../../timeline/mapMessageToTimelineEvent', async () => {
  const actual = (await vi.importActual('../../../timeline/mapMessageToTimelineEvent')) as {
    mapMessageToTimelineEvent: (
      message: never,
      handoffDurationMs?: number,
      handoffDurationSlow?: boolean
    ) => unknown;
  };
  return { mapMessageToTimelineEvent: vi.fn(actual.mapMessageToTimelineEvent) };
});

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    conversation: {
      listPages: 'listPages',
      listPageMessages: 'listPageMessages',
      subscribePageTail: 'subscribePageTail',
    },
  },
}));

const baseResults = [
  { _id: 'msg-1', type: 'message', senderRole: 'user', content: 'hello', _creationTime: 100 },
  { _id: 'msg-2', type: 'message', senderRole: 'builder', content: 'reply', _creationTime: 101 },
];

const pageNavResult = {
  pages: [{ pageId: 'page-1', startedAt: 100, endExclusive: null, contentPreview: 'hello' }],
  selectedPageId: 'page-1',
  prevPageId: null,
  nextPageId: null,
};

function mockSessionQueryForPageNav(pageNav: unknown) {
  mockUseSessionQuery.mockImplementation((queryRef: string, args: unknown) => {
    if (queryRef === 'subscribePageTail') {
      if (args === 'skip') return undefined;
      return null;
    }
    return pageNav;
  });
}

describe('useConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionId.mockReturnValue(['session-1']);
    mockSessionQueryForPageNav(pageNavResult);
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'Exhausted',
      loadMore: vi.fn(),
    });
  });

  it('loads page navigation and paginated messages on mount', () => {
    const { result } = renderHook(() => useConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('listPages', {
      chatroomId: 'room-1',
    });
    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listPageMessages',
      {
        chatroomId: 'room-1',
        sessionId: 'session-1',
        pageId: 'page-1',
        endExclusive: null,
      },
      { initialNumItems: 50 }
    );
    expect(result.current.events).toHaveLength(2);
    expect(result.current.isOnLatestPage).toBe(true);
    expect(result.current.hasPrevPage).toBe(false);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('is not loading when chatroom has no user messages (empty page nav)', () => {
    mockSessionQueryForPageNav({
      pages: [],
      selectedPageId: null,
      prevPageId: null,
      nextPageId: null,
    });
    mockUsePaginatedQuery.mockReturnValue({
      results: [],
      status: 'LoadingFirstPage',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.events).toHaveLength(0);
    expect(mockUsePaginatedQuery).toHaveBeenCalledWith('listPageMessages', 'skip', {
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
    const { result } = renderHook(() => useConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('listPages', 'skip');
    expect(result.current.events).toHaveLength(0);
    expect(result.current.pageNav).toBeUndefined();
  });

  it('exposes page nav state including prev/next and endExclusive', () => {
    mockSessionQueryForPageNav({
      pages: [{ pageId: 'page-mid', startedAt: 150, endExclusive: 200, contentPreview: 'middle' }],
      selectedPageId: 'page-mid',
      prevPageId: 'page-old',
      nextPageId: 'page-new',
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(result.current.hasPrevPage).toBe(true);
    expect(result.current.hasNextPage).toBe(true);
    // Initially selectedPageId is null, so user is on latest
    expect(result.current.isOnLatestPage).toBe(true);

    act(() => {
      result.current.goToPrevPage();
    });

    // After navigating, isOnLatestPage should be false
    expect(result.current.isOnLatestPage).toBe(false);
    expect(result.current.pageNav?.pages[0].endExclusive).toBe(200);
    expect(mockUsePaginatedQuery).toHaveBeenLastCalledWith(
      'listPageMessages',
      {
        chatroomId: 'room-1',
        sessionId: 'session-1',
        pageId: 'page-mid',
        endExclusive: 200,
      },
      { initialNumItems: 50 }
    );
  });

  it('flows the page endExclusive into listPageMessages and subscribePageTail', () => {
    mockSessionQueryForPageNav({
      pages: [{ pageId: 'page-mid', startedAt: 150, endExclusive: 200, contentPreview: 'middle' }],
      selectedPageId: 'page-mid',
      prevPageId: null,
      nextPageId: null,
    });

    renderHook(() => useConversation('room-1'));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listPageMessages',
      expect.objectContaining({ pageId: 'page-mid', endExclusive: 200 }),
      { initialNumItems: 50 }
    );
    const tailCall = mockUseSessionQuery.mock.calls.find((call) => call[0] === 'subscribePageTail');
    expect(tailCall).toBeDefined();
    expect(tailCall![1]).toEqual({
      chatroomId: 'room-1',
      afterCreationTime: 101,
      endExclusive: 200,
    });
  });

  it('derives messages directly from paginated results (no reducer dispatch)', () => {
    const { result, rerender } = renderHook(() => useConversation('room-1'));

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

  it('reuses unchanged event objects when one message changes in place', () => {
    const { result, rerender } = renderHook(() => useConversation('room-1'));
    const before = result.current.events;
    expect(before).toHaveLength(2);

    // A Convex update re-creates every message object; only msg-2 changed.
    mockUsePaginatedQuery.mockReturnValue({
      results: [
        { ...baseResults[0] },
        {
          _id: 'msg-2',
          type: 'notice',
          senderRole: 'builder',
          content: 'reply',
          _creationTime: 101,
        },
      ],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    rerender();

    const after = result.current.events;
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].message.type).toBe('notice');
  });

  it('reuses unchanged event objects when a message is appended', () => {
    const { result, rerender } = renderHook(() => useConversation('room-1'));
    const before = result.current.events;

    mockUsePaginatedQuery.mockReturnValue({
      results: [
        ...baseResults.map((message) => ({ ...message })),
        {
          _id: 'msg-3',
          type: 'message',
          senderRole: 'reviewer',
          content: 'third',
          _creationTime: 102,
        },
      ],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    rerender();

    const after = result.current.events;
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2].id).toBe('msg-3');
  });

  it('reuses message identity when rebuilt nested attachment arrays are equal', () => {
    const withAttachments = {
      ...baseResults[0],
      attachedTasks: [{ _id: 'task-1', content: 'do it' }],
    };
    mockUsePaginatedQuery.mockReturnValue({
      results: [withAttachments],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result, rerender } = renderHook(() => useConversation('room-1'));
    const before = result.current.events;

    // Convex re-runs the query and rebuilds the nested collection.
    mockUsePaginatedQuery.mockReturnValue({
      results: [
        {
          ...withAttachments,
          attachedTasks: [{ _id: 'task-1', content: 'do it' }],
        },
      ],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    rerender();

    expect(result.current.events[0]).toBe(before[0]);
    expect(result.current.messages[0]).toBe(before[0].message);
  });

  it('keeps loadMore identity stable across rerenders', () => {
    const firstLoadMore = vi.fn();
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'CanLoadMore',
      loadMore: firstLoadMore,
    });

    const { result, rerender } = renderHook(() => useConversation('room-1'));
    const initialLoadMore = result.current.loadMore;

    // usePaginatedQuery allocates a new loadMore on every render.
    const nextLoadMore = vi.fn();
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'CanLoadMore',
      loadMore: nextLoadMore,
    });
    rerender();

    expect(result.current.loadMore).toBe(initialLoadMore);

    act(() => {
      result.current.loadMore();
    });
    expect(nextLoadMore).toHaveBeenCalledWith(50);
  });

  it('skips the tail subscription until pagination is exhausted', () => {
    mockUsePaginatedQuery.mockReturnValue({
      results: baseResults,
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('subscribePageTail', 'skip');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map((m) => m._id)).toEqual(['msg-1', 'msg-2']);
  });

  it('subscribes to the tail when pagination is exhausted', () => {
    const { result } = renderHook(() => useConversation('room-1'));

    const tailCall = mockUseSessionQuery.mock.calls.find((call) => call[0] === 'subscribePageTail');
    expect(tailCall).toBeDefined();
    expect(tailCall![1]).toEqual({
      chatroomId: 'room-1',
      afterCreationTime: 101,
      endExclusive: null,
    });
    expect(result.current.messages).toHaveLength(2);
  });

  it('merges tail messages without duplicates when pagination is exhausted', () => {
    const tailMessages = [
      // Duplicate of an already-loaded paginated message (id-based dedup)
      { _id: 'msg-1', type: 'message', senderRole: 'user', content: 'hello', _creationTime: 100 },
      // New live message after the loaded page
      {
        _id: 'msg-live',
        type: 'message',
        senderRole: 'builder',
        content: 'live',
        _creationTime: 150,
      },
    ];
    mockUseSessionQuery.mockImplementation((queryRef: string, args: unknown) => {
      if (queryRef === 'subscribePageTail') {
        if (args === 'skip') return 'skip';
        return tailMessages;
      }
      return pageNavResult;
    });

    const { result } = renderHook(() => useConversation('room-1'));

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

    const { result } = renderHook(() => useConversation('room-1'));

    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.isLoadingMore).toBe(false);

    act(() => {
      result.current.loadMore();
    });

    expect(loadMore).toHaveBeenCalledWith(50);
  });

  it('isOnLatestPage is false when a page is selected', () => {
    mockSessionQueryForPageNav({
      pages: [{ pageId: 'page-mid', startedAt: 150, endExclusive: 200, contentPreview: 'middle' }],
      selectedPageId: 'page-mid',
      prevPageId: 'page-old',
      nextPageId: null,
    });

    const { result } = renderHook(() => useConversation('room-1'));

    act(() => {
      result.current.goToPrevPage();
    });

    expect(result.current.isOnLatestPage).toBe(false);
  });

  it('goToLatestPage clears the selected page so navigation uses latest', () => {
    mockSessionQueryForPageNav({
      pages: [{ pageId: 'page-mid', startedAt: 150, endExclusive: 200, contentPreview: 'middle' }],
      selectedPageId: 'page-mid',
      prevPageId: 'page-old',
      nextPageId: 'page-new',
    });

    const { result } = renderHook(() => useConversation('room-1'));

    act(() => {
      result.current.goToPrevPage();
    });

    const callsWithPageId = mockUseSessionQuery.mock.calls.filter(
      (call) =>
        call[0] === 'listPages' &&
        call[1] !== 'skip' &&
        typeof call[1] === 'object' &&
        'pageId' in call[1]
    );
    expect(callsWithPageId.length).toBeGreaterThan(0);

    act(() => {
      result.current.goToLatestPage();
    });

    const latestNavCall = mockUseSessionQuery.mock.calls
      .filter((call) => call[0] === 'listPages')
      .map((call) => call[1])
      .filter((args) => args !== 'skip')
      .at(-1);
    expect(latestNavCall).toEqual({ chatroomId: 'room-1' });
    expect(latestNavCall).not.toHaveProperty('pageId');
  });

  it('maps user, notice, and handoff to user_message, team_message, team_message with notice carrying no duration', () => {
    const userMessage = {
      _id: 'msg-u',
      type: 'message',
      senderRole: 'user',
      content: 'do it',
      _creationTime: 100,
      acknowledgedAt: 100,
    };
    const notice = {
      _id: 'msg-n',
      type: 'notice',
      senderRole: 'builder',
      targetRole: 'user',
      content: 'heads up',
      _creationTime: 200,
    };
    const handoff = {
      _id: 'msg-h',
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'user',
      content: 'done',
      _creationTime: 500,
    };
    mockUsePaginatedQuery.mockReturnValue({
      results: [userMessage, notice, handoff],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(result.current.events.map((event) => event.kind)).toEqual([
      'user_message',
      'team_message',
      'team_message',
    ]);
    expect(result.current.events.map((event) => event.id)).toEqual(['msg-u', 'msg-n', 'msg-h']);

    const noticeEvent = result.current.events[1];
    expect(noticeEvent.message.type).toBe('notice');
    expect((noticeEvent as { handoffDurationMs?: number }).handoffDurationMs).toBeUndefined();

    expect(result.current.events[2]).toMatchObject({
      kind: 'team_message',
      handoffDurationMs: 300,
    });
  });

  it('reports each handoff duration as the gap from the previous message, not the shared origin lifecycle', () => {
    // The bug scenario: one origin task acknowledged at 0 and completed at 67s,
    // with a five-handoff chain that all reference it. The frozen origin lifecycle
    // made every row show 67_000; the true elapsed times differ per row.
    const origin = {
      _id: 'msg-u',
      type: 'message',
      senderRole: 'user',
      content: 'do it',
      _creationTime: 0,
      acknowledgedAt: 0,
      completedAt: 67_000,
    };
    const chain = [72_000, 180_000, 600_000, 660_000, 690_000].map((creationTime, index) => ({
      _id: `msg-h${index + 1}`,
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'user',
      content: `step ${index + 1}`,
      _creationTime: creationTime,
      taskOriginMessageId: origin._id,
    }));
    mockUsePaginatedQuery.mockReturnValue({
      results: [origin, ...chain],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(
      result.current.events.map(
        (event) => (event as { handoffDurationMs?: number }).handoffDurationMs
      )
    ).toEqual([undefined, 72_000, 108_000, 420_000, 60_000, 30_000]);
  });

  it('marks handoffs that are much longer than the window median as slow', () => {
    // The screenshot scenario: gaps 60k,120k,420k,480k,60k -> median 120k,
    // threshold 3x = 360k -> the 7m and 8m handoffs are slow.
    const user = {
      _id: 'msg-u',
      type: 'message',
      senderRole: 'user',
      content: 'do it',
      _creationTime: 0,
    };
    const chain = [60_000, 180_000, 600_000, 1_080_000, 1_140_000].map((creationTime, index) => ({
      _id: `msg-h${index + 1}`,
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'user',
      content: `step ${index + 1}`,
      _creationTime: creationTime,
    }));
    mockUsePaginatedQuery.mockReturnValue({
      results: [user, ...chain],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(
      result.current.events.map(
        (event) => (event as { handoffDurationMs?: number }).handoffDurationMs
      )
    ).toEqual([undefined, 60_000, 120_000, 420_000, 480_000, 60_000]);
    expect(
      result.current.events.map(
        (event) => (event as { handoffDurationSlow?: boolean }).handoffDurationSlow
      )
    ).toEqual([undefined, false, false, true, true, false]);
  });

  it('marks no handoff slow with fewer than four gaps in the window', () => {
    const user = {
      _id: 'msg-u',
      type: 'message',
      senderRole: 'user',
      content: 'do it',
      _creationTime: 0,
    };
    const chain = [10_000, 20_000, 600_000].map((creationTime, index) => ({
      _id: `msg-h${index + 1}`,
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'user',
      content: `step ${index + 1}`,
      _creationTime: creationTime,
    }));
    mockUsePaginatedQuery.mockReturnValue({
      results: [user, ...chain],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    expect(
      result.current.events.map(
        (event) => (event as { handoffDurationSlow?: boolean }).handoffDurationSlow
      )
    ).toEqual([undefined, false, false, false]);
  });

  it('gives notices and user messages no slow flag even when the window is slow-heavy', () => {
    const user = {
      _id: 'msg-u',
      type: 'message',
      senderRole: 'user',
      content: 'do it',
      _creationTime: 0,
    };
    const messages = [
      {
        _id: 'msg-h1',
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'a',
        _creationTime: 60_000,
      },
      {
        _id: 'msg-n',
        type: 'notice',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'heads up',
        _creationTime: 600_000,
      },
      {
        _id: 'msg-h2',
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'b',
        _creationTime: 1_080_000,
      },
      {
        _id: 'msg-h3',
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'c',
        _creationTime: 1_200_000,
      },
    ];
    mockUsePaginatedQuery.mockReturnValue({
      results: [user, ...messages],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useConversation('room-1'));

    const noticeEvent = result.current.events[2];
    expect(noticeEvent.message.type).toBe('notice');
    expect((noticeEvent as { handoffDurationMs?: number }).handoffDurationMs).toBeUndefined();
    expect((noticeEvent as { handoffDurationSlow?: boolean }).handoffDurationSlow).toBeFalsy();
    expect(
      (result.current.events[0] as { handoffDurationSlow?: boolean }).handoffDurationSlow
    ).toBeUndefined();
  });

  it('keeps handoff event identity stable when the results array is rebuilt with equal values', () => {
    const results = [
      { _id: 'msg-u', type: 'message', senderRole: 'user', content: 'do it', _creationTime: 0 },
      {
        _id: 'msg-h',
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'done',
        _creationTime: 500,
      },
    ];
    mockUsePaginatedQuery.mockReturnValue({
      results,
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result, rerender } = renderHook(() => useConversation('room-1'));
    const before = result.current.events;
    expect(before).toHaveLength(2);

    mockUsePaginatedQuery.mockReturnValue({
      results: results.map((message) => ({ ...message })),
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    rerender();

    const after = result.current.events;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect((after[1] as { handoffDurationMs?: number }).handoffDurationMs).toBe(500);
  });
});
