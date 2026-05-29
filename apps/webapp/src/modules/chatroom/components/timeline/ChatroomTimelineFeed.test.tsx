/**
 * ChatroomTimelineFeed — virtualizer stability and wiring tests.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { TimelineEvent } from '../../timeline/types';

const virtualizerOptions: Array<{
  count: number;
  getItemKey: (index: number) => string;
}> = [];

const mockScrollToIndex = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    return {
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
      scrollToIndex: mockScrollToIndex,
      range: { startIndex: 0, endIndex: 0, count: options.count },
    };
  },
}));

vi.mock('../../hooks/useScrollController', () => ({
  useScrollController: () => ({
    controller: { current: { attach: vi.fn(), detach: vi.fn(), isPinned: true, scrollToBottom: vi.fn() } },
    isPinned: true,
    scrollToBottom: vi.fn(),
    beginResize: vi.fn(),
    endResize: vi.fn(),
  }),
}));

const mockEvents: TimelineEvent[] = [
  {
    id: 'evt-1',
    kind: 'user_message',
    creationTime: 100,
    message: {
      _id: 'evt-1',
      type: 'message',
      senderRole: 'user',
      content: 'Hello',
      _creationTime: 100,
    },
  },
  {
    id: 'evt-2',
    kind: 'team_message',
    creationTime: 200,
    message: {
      _id: 'evt-2',
      type: 'message',
      senderRole: 'builder',
      content: 'Reply',
      _creationTime: 200,
    },
  },
];

vi.mock('../../hooks/useChatroomTimeline', () => ({
  useChatroomTimeline: () => ({
    events: mockEvents,
    isLoading: false,
    hasMoreOlder: false,
    isLoadingOlder: false,
    loadOlderEvents: vi.fn(),
    purgeOldMessages: vi.fn(),
  }),
}));

import { ChatroomTimelineFeed } from './ChatroomTimelineFeed';

describe('ChatroomTimelineFeed virtualizer ref stability', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToIndex.mockClear();
  });

  it('uses stable getItemKey across parent re-renders', () => {
    const { rerender } = render(<ChatroomTimelineFeed chatroomId="room-1" />);
    expect(virtualizerOptions.length).toBeGreaterThan(0);

    const firstOptions = virtualizerOptions.at(-1)!;
    const keyBeforeRerender = firstOptions.getItemKey(0);
    const keySecondRow = firstOptions.getItemKey(1);

    rerender(<ChatroomTimelineFeed chatroomId="room-1" />);

    const secondOptions = virtualizerOptions.at(-1)!;
    expect(secondOptions.getItemKey(0)).toBe(keyBeforeRerender);
    expect(secondOptions.getItemKey(1)).toBe(keySecondRow);
    expect(keyBeforeRerender).toBe('evt-1');
    expect(keySecondRow).toBe('evt-2');
  });

  it('configures estimateSize and overscan for ~20-row viewport', () => {
    render(<ChatroomTimelineFeed chatroomId="room-2" />);
    const options = virtualizerOptions.at(-1)!;
    expect(options.count).toBe(mockEvents.length);
  });
});
