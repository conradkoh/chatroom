import { renderHook } from '@testing-library/react';
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

describe('useAllTabConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionId.mockReturnValue(['session-1']);
    mockUseSessionQuery.mockReturnValue({
      anchor: { _id: 'anchor-1', _creationTime: 100, contentPreview: 'hello' },
      prevAnchorId: null,
      nextAnchorId: null,
      sliceUpperBoundExclusive: null,
    });
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
    expect(mockUsePaginatedQuery).toHaveBeenCalled();
    expect(result.current.events).toHaveLength(2);
    expect(result.current.isOnLatestAnchor).toBe(true);
    expect(result.current.hasPrev).toBe(false);
    expect(result.current.hasNext).toBe(false);
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
    mockUseSessionQuery.mockReturnValue({
      anchor: { _id: 'anchor-mid', _creationTime: 150, contentPreview: 'middle' },
      prevAnchorId: 'anchor-old',
      nextAnchorId: 'anchor-new',
      sliceUpperBoundExclusive: 200,
    });

    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.hasPrev).toBe(true);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.isOnLatestAnchor).toBe(false);
    expect(result.current.nav?.sliceUpperBoundExclusive).toBe(200);
  });

  it('dispatches SET_INITIAL with paginated results', () => {
    const { result } = renderHook(() => useAllTabConversation('room-1'));

    expect(result.current.events).toHaveLength(2);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]._id).toBe('msg-1');
    expect(result.current.messages[1]._id).toBe('msg-2');
  });
});
