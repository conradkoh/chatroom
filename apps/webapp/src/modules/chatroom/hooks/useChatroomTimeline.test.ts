/**
 * Unit tests for useChatroomTimeline — event mapping over useMessages.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Message } from '../types/message';

const mockUseMessages = vi.fn();

vi.mock('./useMessages', () => ({
  useMessages: (...args: unknown[]) => mockUseMessages(...args),
}));

import { useChatroomTimeline } from './useChatroomTimeline';

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

describe('useChatroomTimeline', () => {
  beforeEach(() => {
    mockUseMessages.mockReset();
    mockUseMessages.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
      purgeOldMessages: vi.fn(),
    });
  });

  it('passes through loading and pagination state from useMessages', () => {
    const loadOlderMessages = vi.fn();
    const purgeOldMessages = vi.fn();
    mockUseMessages.mockReturnValue({
      messages: [],
      isLoading: true,
      hasMoreOlder: true,
      isLoadingOlder: true,
      loadOlderMessages,
      purgeOldMessages,
    });

    const { result } = renderHook(() => useChatroomTimeline('room-1'));

    expect(mockUseMessages).toHaveBeenCalledWith('room-1');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasMoreOlder).toBe(true);
    expect(result.current.isLoadingOlder).toBe(true);
    expect(result.current.loadOlderEvents).toBe(loadOlderMessages);
    expect(result.current.purgeOldMessages).toBe(purgeOldMessages);
  });

  it('maps messages to timeline events in order', () => {
    mockUseMessages.mockReturnValue({
      messages: [
        makeMessage('ctx-1', 1000, { type: 'new-context', senderRole: 'system' }),
        makeMessage('user-1', 2000, { senderRole: 'user', type: 'message' }),
        makeMessage('team-1', 3000, { senderRole: 'builder', type: 'message' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
      purgeOldMessages: vi.fn(),
    });

    const { result } = renderHook(() => useChatroomTimeline('room-1'));

    expect(result.current.events.map((e) => e.kind)).toEqual([
      'context',
      'user_message',
      'team_message',
    ]);
    expect(result.current.events.map((e) => e.id)).toEqual(['ctx-1', 'user-1', 'team-1']);
  });
});
