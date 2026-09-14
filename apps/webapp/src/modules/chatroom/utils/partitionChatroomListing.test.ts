import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import {
  deriveChatroomState,
  isChatroomStopAvailable,
} from '@workspace/shared/domain/chatroom-activity-status';
import { describe, expect, it } from 'vitest';

import {
  flattenPartitionedCurrent,
  partitionChatroomListing,
  RECENCY_SECTIONS,
} from './partitionChatroomListing';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

import type { ChatroomRemoteAgentStatus, ChatroomStatus } from '@/domain/entities/chatroom-status';

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function makeChatroom(
  overrides: Partial<ChatroomWithStatus> &
    Pick<ChatroomWithStatus, '_id'> & {
      activityStatus?: ChatroomActivityStatus;
      remoteAgentStatus?: ChatroomRemoteAgentStatus;
    }
): ChatroomWithStatus {
  const {
    activityStatus: _activityStatus,
    remoteAgentStatus: _remoteAgentStatus,
    ...rest
  } = overrides;
  return {
    _creationTime: NOW - 1_000,
    status: 'active' as const,
    teamId: 'team-1',
    teamName: 'Team',
    teamRoles: [],
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
    ...rest,
  };
}

const statuses = new Map<string, ChatroomStatus>();

function makeStatusAwareChatroom(
  overrides: Parameters<typeof makeChatroom>[0]
): ChatroomWithStatus {
  const chatroom = makeChatroom(overrides);
  statuses.set(
    chatroom._id,
    makeStatus(
      chatroom._id,
      overrides.activityStatus ?? 'idle',
      overrides.remoteAgentStatus ?? 'none'
    )
  );
  return chatroom;
}

function makeStatus(
  chatroomId: string,
  activityStatus: ChatroomActivityStatus,
  remoteAgentStatus: ChatroomRemoteAgentStatus
): ChatroomStatus {
  return {
    chatroomId,
    activityStatus,
    state: deriveChatroomState(activityStatus),
    remoteAgentStatus,
    canStop: remoteAgentStatus === 'running' || isChatroomStopAvailable(activityStatus),
  };
}

describe('partitionChatroomListing', () => {
  it('separates active, recency-bucketed idle, and completed chatrooms', () => {
    const chatrooms = [
      makeStatusAwareChatroom({ _id: 'active-1', activityStatus: 'working', _creationTime: 100 }),
      makeStatusAwareChatroom({ _id: 'active-2', activityStatus: 'active', _creationTime: 200 }),
      makeStatusAwareChatroom({
        _id: 'idle-day',
        activityStatus: 'idle',
        lastActivityAt: NOW - 1_000,
      }),
      makeStatusAwareChatroom({
        _id: 'idle-week',
        activityStatus: 'idle',
        lastActivityAt: NOW - WEEK_MS + 1_000,
      }),
      makeStatusAwareChatroom({ _id: 'done', activityStatus: 'completed' }),
    ];

    const partitioned = partitionChatroomListing(chatrooms, statuses);

    expect(partitioned.active.map((c) => c._id)).toEqual(['active-1', 'active-2']);
    expect(partitioned.completed.map((c) => c._id)).toEqual(['done']);
    expect(partitioned.recentByRecency.lastDay.map((c) => c._id)).toEqual(['idle-day']);
    expect(partitioned.recentByRecency.lastWeek.map((c) => c._id)).toEqual(['idle-week']);
    expect(partitioned.recentByRecency.lastMonth).toEqual([]);
    expect(partitioned.recentByRecency.older).toEqual([]);
  });

  it('includes transitioning chatrooms in active section', () => {
    const chatrooms = [
      makeStatusAwareChatroom({
        _id: 'transitioning',
        activityStatus: 'transitioning',
        _creationTime: 100,
      }),
      makeStatusAwareChatroom({
        _id: 'idle-day',
        activityStatus: 'idle',
        lastActivityAt: NOW - 1_000,
      }),
    ];

    const partitioned = partitionChatroomListing(chatrooms, statuses);

    expect(partitioned.active.map((c) => c._id)).toEqual(['transitioning']);
    expect(partitioned.recentByRecency.lastDay.map((c) => c._id)).toEqual(['idle-day']);
  });

  it('excludes active and completed chatrooms from recency buckets', () => {
    const chatrooms = [
      makeStatusAwareChatroom({
        _id: 'active',
        activityStatus: 'active',
        lastActivityAt: NOW - 1_000,
      }),
      makeStatusAwareChatroom({
        _id: 'done',
        activityStatus: 'completed',
        lastActivityAt: NOW - 1_000,
      }),
      makeStatusAwareChatroom({ _id: 'idle', activityStatus: 'idle', lastActivityAt: NOW - 1_000 }),
    ];

    const partitioned = partitionChatroomListing(chatrooms, statuses);

    expect(partitioned.active.map((c) => c._id)).toEqual(['active']);
    expect(partitioned.completed.map((c) => c._id)).toEqual(['done']);
    expect(partitioned.recentByRecency.lastDay.map((c) => c._id)).toEqual(['idle']);
  });
});

describe('flattenPartitionedCurrent', () => {
  it('preserves active-first then recency section order', () => {
    const partitioned = partitionChatroomListing(
      [
        makeStatusAwareChatroom({
          _id: 'older',
          activityStatus: 'idle',
          lastActivityAt: NOW - 40 * DAY_MS,
        }),
        makeStatusAwareChatroom({ _id: 'active', activityStatus: 'active', _creationTime: 50 }),
        makeStatusAwareChatroom({
          _id: 'day',
          activityStatus: 'idle',
          lastActivityAt: NOW - 1_000,
        }),
        makeStatusAwareChatroom({
          _id: 'week',
          activityStatus: 'idle',
          lastActivityAt: NOW - WEEK_MS,
        }),
      ],
      statuses
    );

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
