import { describe, expect, it } from 'vitest';

import {
  flattenPartitionedCurrent,
  partitionChatroomListing,
  RECENCY_SECTIONS,
} from './partitionChatroomListing';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function makeChatroom(
  overrides: Partial<ChatroomWithStatus> & Pick<ChatroomWithStatus, '_id'>
): ChatroomWithStatus {
  return {
    _creationTime: NOW - 1_000,
    status: 'active',
    chatStatus: 'idle',
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: [],
    agents: [],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    remoteAgentStatus: 'none',
    runningRoles: [],
    runningAgentConfigs: [],
    ...overrides,
  };
}

describe('partitionChatroomListing', () => {
  it('separates active, recency-bucketed idle, and completed chatrooms', () => {
    const chatrooms = [
      makeChatroom({ _id: 'active-1', chatStatus: 'working', _creationTime: 100 }),
      makeChatroom({ _id: 'active-2', chatStatus: 'active', _creationTime: 200 }),
      makeChatroom({ _id: 'idle-day', chatStatus: 'idle', lastActivityAt: NOW - 1_000 }),
      makeChatroom({
        _id: 'idle-week',
        chatStatus: 'idle',
        lastActivityAt: NOW - WEEK_MS + 1_000,
      }),
      makeChatroom({ _id: 'done', chatStatus: 'completed' }),
    ];

    const partitioned = partitionChatroomListing(chatrooms);

    expect(partitioned.active.map((c) => c._id)).toEqual(['active-1', 'active-2']);
    expect(partitioned.completed.map((c) => c._id)).toEqual(['done']);
    expect(partitioned.recentByRecency.lastDay.map((c) => c._id)).toEqual(['idle-day']);
    expect(partitioned.recentByRecency.lastWeek.map((c) => c._id)).toEqual(['idle-week']);
    expect(partitioned.recentByRecency.lastMonth).toEqual([]);
    expect(partitioned.recentByRecency.older).toEqual([]);
  });

  it('excludes active and completed chatrooms from recency buckets', () => {
    const chatrooms = [
      makeChatroom({ _id: 'active', chatStatus: 'active', lastActivityAt: NOW - 1_000 }),
      makeChatroom({ _id: 'done', chatStatus: 'completed', lastActivityAt: NOW - 1_000 }),
      makeChatroom({ _id: 'idle', chatStatus: 'idle', lastActivityAt: NOW - 1_000 }),
    ];

    const partitioned = partitionChatroomListing(chatrooms);

    expect(partitioned.active.map((c) => c._id)).toEqual(['active']);
    expect(partitioned.completed.map((c) => c._id)).toEqual(['done']);
    expect(partitioned.recentByRecency.lastDay.map((c) => c._id)).toEqual(['idle']);
  });
});

describe('flattenPartitionedCurrent', () => {
  it('preserves active-first then recency section order', () => {
    const partitioned = partitionChatroomListing([
      makeChatroom({ _id: 'older', chatStatus: 'idle', lastActivityAt: NOW - 40 * DAY_MS }),
      makeChatroom({ _id: 'active', chatStatus: 'active', _creationTime: 50 }),
      makeChatroom({ _id: 'day', chatStatus: 'idle', lastActivityAt: NOW - 1_000 }),
      makeChatroom({ _id: 'week', chatStatus: 'idle', lastActivityAt: NOW - WEEK_MS }),
    ]);

    expect(flattenPartitionedCurrent(partitioned).map((c) => c._id)).toEqual([
      'active',
      'day',
      'week',
      'older',
    ]);
    expect(RECENCY_SECTIONS.map((s) => s.label)).toEqual([
      'Last Day',
      'Last Week',
      'Last Month',
      'Older',
    ]);
  });
});
