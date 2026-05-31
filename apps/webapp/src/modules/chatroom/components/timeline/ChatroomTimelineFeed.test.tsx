/**
 * ChatroomTimelineFeed — virtualizer stability and wiring tests.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type React from 'react';

import type { ScrollController } from '../../hooks/useScrollController';
import type { TimelineEvent } from '../../timeline/types';

const virtualizerOptions: Array<{
  count: number;
  getItemKey: (index: number) => string;
}> = [];

const mockScrollToEnd = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: (typeof virtualizerOptions)[0]) => {
    virtualizerOptions.push(options);
    return {
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
      scrollToEnd: mockScrollToEnd,
      range: { startIndex: 0, endIndex: 0, count: options.count },
    };
  },
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

vi.mock('../QueuedMessagesIndicator', () => ({
  QueuedMessagesIndicator: () => null,
}));

vi.mock('../EventStreamModal', () => ({
  EventStreamModal: () => null,
}));

vi.mock('../../hooks/useHandoffNotification', () => ({
  useHandoffNotification: vi.fn(),
}));

const scrollController = {
  attach: vi.fn(),
  detach: vi.fn(),
  isPinned: true,
  scrollToBottom: vi.fn(),
  snapToBottom: vi.fn(),
};

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

const defaultProps = {
  chatroomId: 'room-1',
  controller: { current: scrollController } as unknown as React.MutableRefObject<ScrollController>,
  isPinned: true,
};

describe.skip('ChatroomTimelineFeed virtualizer ref stability', () => {
  beforeEach(() => {
    virtualizerOptions.length = 0;
    mockScrollToEnd.mockClear();
  });

  it('enables end-anchored chat virtualizer options', () => {
    render(<ChatroomTimelineFeed {...defaultProps} />);
    const options = virtualizerOptions.at(-1)! as (typeof virtualizerOptions)[0] & {
      anchorTo?: string;
      followOnAppend?: string;
    };
    expect(options.anchorTo).toBe('end');
    expect(options.followOnAppend).toBe('smooth');
  });

  it('uses stable getItemKey across parent re-renders', () => {
    const { rerender } = render(<ChatroomTimelineFeed {...defaultProps} />);
    expect(virtualizerOptions.length).toBeGreaterThan(0);

    const firstOptions = virtualizerOptions.at(-1)!;
    const keyBeforeRerender = firstOptions.getItemKey(0);
    const keySecondRow = firstOptions.getItemKey(1);

    rerender(<ChatroomTimelineFeed {...defaultProps} />);

    const secondOptions = virtualizerOptions.at(-1)!;
    expect(secondOptions.getItemKey(0)).toBe(keyBeforeRerender);
    expect(secondOptions.getItemKey(1)).toBe(keySecondRow);
    expect(keyBeforeRerender).toBe('evt-1');
    expect(keySecondRow).toBe('evt-2');
  });

  it('configures virtualizer count from timeline events', () => {
    render(<ChatroomTimelineFeed {...defaultProps} chatroomId="room-2" />);
    const options = virtualizerOptions.at(-1)!;
    expect(options.count).toBe(mockEvents.length);
  });
});
