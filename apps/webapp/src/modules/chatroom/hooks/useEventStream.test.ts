/**
 * useEventStream — paginated chatroom event stream for settings tab.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEventStream } from './useEventStream';

const mockUsePaginatedQuery = vi.fn();

vi.mock('convex/react', () => ({
  usePaginatedQuery: (...args: unknown[]) => mockUsePaginatedQuery(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    events: {
      listLatestEventsPaginated: 'listLatestEventsPaginated',
    },
  },
}));

describe('useEventStream', () => {
  beforeEach(() => {
    mockUsePaginatedQuery.mockReset();
    mockUsePaginatedQuery.mockReturnValue({
      results: [{ _id: 'evt-1', type: 'task.inProgress', _creationTime: 100 }],
      status: 'CanLoadMore',
      loadMore: vi.fn(),
    });
  });

  it('queries paginated events when enabled', () => {
    const { result } = renderHook(() => useEventStream('room-1', true));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith(
      'listLatestEventsPaginated',
      { chatroomId: 'room-1', sessionId: 'session-1' },
      { initialNumItems: 20 }
    );
    expect(result.current.events).toHaveLength(1);
    expect(result.current.canLoadMore).toBe(true);
  });

  it('skips query when disabled', () => {
    renderHook(() => useEventStream('room-1', false));

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith('listLatestEventsPaginated', 'skip', {
      initialNumItems: 20,
    });
  });
});
