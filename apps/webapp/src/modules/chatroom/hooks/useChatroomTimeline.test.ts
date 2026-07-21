/**
 * Unit tests for useChatroomTimeline — event mapping over useChatroomMessageStore.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChatroomTimeline } from './useChatroomTimeline';
import type { Message } from '../types/message';

const mockUseChatroomMessageStore = vi.fn();

vi.mock('./useChatroomMessageStore', () => ({
  useChatroomMessageStore: (...args: unknown[]) => mockUseChatroomMessageStore(...args),
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

describe('useChatroomTimeline', () => {
  beforeEach(() => {
    mockUseChatroomMessageStore.mockReset();
    mockUseChatroomMessageStore.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
  });

  it('passes through loading and pagination state from useChatroomMessageStore', () => {
    const loadOlderMessages = vi.fn();
    mockUseChatroomMessageStore.mockReturnValue({
      messages: [],
      isLoading: true,
      hasMoreOlder: true,
      isLoadingOlder: true,
      loadOlderMessages,
    });

    const { result } = renderHook(() => useChatroomTimeline('room-1'));

    expect(mockUseChatroomMessageStore).toHaveBeenCalledWith('room-1', true);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasMoreOlder).toBe(true);
    expect(result.current.isLoadingOlder).toBe(true);
    expect(result.current.loadOlderEvents).toBe(loadOlderMessages);
  });

  it('maps messages to timeline events in order', () => {
    mockUseChatroomMessageStore.mockReturnValue({
      messages: [
        makeMessage('ctx-1', 1000, { type: 'new-context', senderRole: 'system' }),
        makeMessage('user-1', 2000, { senderRole: 'user', type: 'message' }),
        makeMessage('team-1', 3000, { senderRole: 'builder', type: 'message' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });

    const { result } = renderHook(() => useChatroomTimeline('room-1'));

    expect(result.current.events.map((e) => e.kind)).toEqual([
      'context',
      'user_message',
      'team_message',
    ]);
    expect(result.current.events.map((e) => e.id)).toEqual(['ctx-1', 'user-1', 'team-1']);
  });

  it('disables the message store when enabled is false', () => {
    const { result } = renderHook(() => useChatroomTimeline('room-1', false));

    expect(mockUseChatroomMessageStore).toHaveBeenCalledWith('room-1', false);
    expect(result.current.events).toEqual([]);
  });
});
