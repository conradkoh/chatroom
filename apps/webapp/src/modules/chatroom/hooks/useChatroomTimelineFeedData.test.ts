/**
 * Unit tests for useChatroomTimelineFeedData — all vs role-filtered data paths.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatroomTimelineFeedData } from './useChatroomTimelineFeedData';
import type { Message } from '../types/message';

const mockUseChatroomTimeline = vi.fn();
const mockUseFilteredMessagesByRole = vi.fn();
const mockUseHandoffNotification = vi.fn();

vi.mock('./useChatroomTimeline', () => ({
  useChatroomTimeline: (...args: unknown[]) => mockUseChatroomTimeline(...args),
}));

vi.mock('./useFilteredMessagesByRole', () => ({
  useFilteredMessagesByRole: (...args: unknown[]) => mockUseFilteredMessagesByRole(...args),
}));

vi.mock('./useHandoffNotification', () => ({
  useHandoffNotification: (...args: unknown[]) => mockUseHandoffNotification(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => [],
  useSessionId: () => ['session-1'],
}));

vi.mock('convex/react', () => ({
  usePaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    events: {
      listLatestEvents: 'listLatestEvents',
      listLatestEventsPaginated: 'listLatestEventsPaginated',
    },
  },
}));

function makeMessage(id: string, creationTime: number, overrides: Partial<Message> = {}): Message {
  return {
    _id: id,
    _creationTime: creationTime,
    type: 'message',
    senderRole: 'user',
    content: `Message ${id}`,
    ...overrides,
  };
}

describe('useChatroomTimelineFeedData', () => {
  beforeEach(() => {
    mockUseChatroomTimeline.mockReset();
    mockUseFilteredMessagesByRole.mockReset();
    mockUseHandoffNotification.mockReset();

    mockUseChatroomTimeline.mockReturnValue({
      events: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderEvents: vi.fn(),
      removeMessagesForTask: vi.fn(),
      purgeToInitialWindow: vi.fn(),
    });

    mockUseFilteredMessagesByRole.mockReturnValue({
      messages: [],
      isLoading: false,
      isLoadingMore: false,
      canLoadMore: false,
      loadMore: vi.fn(),
    });
  });

  it('uses main timeline data when senderRoleFilter is null', () => {
    const loadOlderEvents = vi.fn();
    mockUseChatroomTimeline.mockReturnValue({
      events: [
        {
          id: 'evt-1',
          kind: 'user_message',
          creationTime: 100,
          message: makeMessage('evt-1', 100),
        },
      ],
      isLoading: true,
      hasMoreOlder: true,
      isLoadingOlder: true,
      loadOlderEvents,
      removeMessagesForTask: vi.fn(),
      purgeToInitialWindow: vi.fn(),
    });

    const { result } = renderHook(() => useChatroomTimelineFeedData('room-1', null));

    expect(mockUseFilteredMessagesByRole).toHaveBeenCalledWith('room-1', '', false);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasMoreOlder).toBe(true);
    expect(result.current.isLoadingOlder).toBe(true);
    expect(result.current.loadOlderEvents).toBe(loadOlderEvents);
  });

  it('uses role-filtered pagination and reverses to chronological order', () => {
    const loadMore = vi.fn();
    mockUseFilteredMessagesByRole.mockReturnValue({
      messages: [
        makeMessage('newest', 3000, { senderRole: 'user' }),
        makeMessage('middle', 2000, { senderRole: 'user' }),
        makeMessage('oldest', 1000, { senderRole: 'user' }),
      ],
      isLoading: false,
      isLoadingMore: true,
      canLoadMore: true,
      loadMore,
    });

    const { result } = renderHook(() => useChatroomTimelineFeedData('room-1', 'user'));

    expect(mockUseFilteredMessagesByRole).toHaveBeenCalledWith('room-1', 'user', true);
    expect(result.current.events.map((event) => event.id)).toEqual(['oldest', 'middle', 'newest']);
    expect(result.current.hasMoreOlder).toBe(true);
    expect(result.current.isLoadingOlder).toBe(true);
    expect(result.current.loadOlderEvents).toBe(loadMore);
    expect(result.current.removeMessagesForTask).not.toBe(
      mockUseChatroomTimeline.mock.results[0]?.value.removeMessagesForTask
    );
  });
});
