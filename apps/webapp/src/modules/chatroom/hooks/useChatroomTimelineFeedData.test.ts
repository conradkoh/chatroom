/**
 * Unit tests for useChatroomTimelineFeedData — role-filtered data path.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatroomTimelineFeedData } from './useChatroomTimelineFeedData';
import type { Message } from '../types/message';

const mockUseFilteredMessagesByRole = vi.fn();
const mockUseHandoffNotification = vi.fn();

vi.mock('./useFilteredMessagesByRole', () => ({
  useFilteredMessagesByRole: (...args: unknown[]) => mockUseFilteredMessagesByRole(...args),
}));

vi.mock('./useHandoffNotification', () => ({
  useHandoffNotification: (...args: unknown[]) => mockUseHandoffNotification(...args),
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
    mockUseFilteredMessagesByRole.mockReset();
    mockUseHandoffNotification.mockReset();

    mockUseFilteredMessagesByRole.mockReturnValue({
      messages: [],
      isLoading: false,
      isLoadingMore: false,
      canLoadMore: false,
      loadMore: vi.fn(),
    });
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
  });
});
