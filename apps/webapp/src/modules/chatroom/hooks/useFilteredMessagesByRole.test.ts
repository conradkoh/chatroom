import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_STORE_LIMIT, MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE } from './chatroomMessageStore';
import { useFilteredMessagesByRole } from './useFilteredMessagesByRole';

const mockUsePaginatedQuery = vi.fn();
const mockLoadMore = vi.fn();

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => mockUsePaginatedQuery(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      listMessagesBySenderRolePaginated: 'listMessagesBySenderRolePaginated',
    },
  },
}));

describe('useFilteredMessagesByRole', () => {
  beforeEach(() => {
    mockUsePaginatedQuery.mockReset();
    mockLoadMore.mockReset();
    mockUsePaginatedQuery.mockReturnValue({
      results: [],
      status: 'LoadingFirstPage',
      loadMore: mockLoadMore,
    });
  });

  it('requests the same initial page size as the All tab message store', () => {
    renderHook(() => useFilteredMessagesByRole('room-1', 'planner', true));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listMessagesBySenderRolePaginated',
      expect.objectContaining({ chatroomId: 'room-1', senderRole: 'planner' }),
      { initialNumItems: MESSAGE_STORE_LIMIT }
    );
  });

  it('skips the query when disabled', () => {
    renderHook(() => useFilteredMessagesByRole('room-1', 'planner', false));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listMessagesBySenderRolePaginated',
      'skip',
      { initialNumItems: MESSAGE_STORE_LIMIT }
    );
  });

  it('loads older pages using the shared timeline page size', () => {
    const { result } = renderHook(() => useFilteredMessagesByRole('room-1', 'planner', true));

    result.current.loadMore();

    expect(mockLoadMore).toHaveBeenCalledWith(MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE);
  });
});
