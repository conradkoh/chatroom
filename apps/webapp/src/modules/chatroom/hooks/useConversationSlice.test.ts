/**
 * useConversationSlice — paginated thread from anchor user message.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationSlice } from './useConversationSlice';

const mockUsePaginatedQuery = vi.fn();

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => mockUsePaginatedQuery(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('./chatroomMessageStore', () => ({
  toMessage: (m: { _id: string }) => m,
}));

vi.mock('../timeline/mapMessageToTimelineEvent', () => ({
  mapMessageToTimelineEvent: (message: { _id: string }) => ({
    id: message._id,
    kind: 'user_message',
    creationTime: 100,
    message,
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      listConversationSlicePaginated: 'listConversationSlicePaginated',
    },
  },
}));

describe('useConversationSlice', () => {
  beforeEach(() => {
    mockUsePaginatedQuery.mockReset();
    mockUsePaginatedQuery.mockReturnValue({
      results: [
        {
          _id: 'anchor-1',
          type: 'message',
          senderRole: 'user',
          content: 'Hello',
          _creationTime: 100,
        },
      ],
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    });
  });

  it('queries conversation slice when anchor is set', () => {
    const { result } = renderHook(() => useConversationSlice('room-1', 'anchor-1' as never));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listConversationSlicePaginated',
      {
        chatroomId: 'room-1',
        sessionId: 'session-1',
        anchorMessageId: 'anchor-1',
      },
      { initialNumItems: 30 }
    );
    expect(result.current.events).toHaveLength(1);
    expect(result.current.canLoadMore).toBe(true);
  });

  it('skips query when anchor is null', () => {
    renderHook(() => useConversationSlice('room-1', null));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith('listConversationSlicePaginated', 'skip', {
      initialNumItems: 30,
    });
  });
});
