import { groupChatroomsByRecency, type RecencyBucket } from './groupChatroomsByRecency';
import type { ChatroomStatus } from '../../../domain/entities/chatroom-status';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

export const RECENCY_SECTIONS: readonly { key: RecencyBucket; label: string }[] = [
  { key: 'lastDay', label: 'Last Day' },
  { key: 'lastWeek', label: 'Last Week' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'older', label: 'Older' },
] as const;

export interface PartitionedChatroomListing {
  active: ChatroomWithStatus[];
  recentByRecency: Record<RecencyBucket, ChatroomWithStatus[]>;
  completed: ChatroomWithStatus[];
}

export function partitionChatroomListing(
  chatrooms: ChatroomWithStatus[],
  statuses: ReadonlyMap<string, ChatroomStatus>
): PartitionedChatroomListing {
  const completed = chatrooms.filter(
    (c) => c.status === 'completed' || statuses.get(c._id)?.state === 'completed'
  );

  const active = chatrooms
    .filter((c) => {
      const state = statuses.get(c._id)?.state;
      return state === 'active' || state === 'attention';
    })
    .sort((a, b) => a._creationTime - b._creationTime);

  const activeIds = new Set(active.map((c) => c._id));
  const remaining = chatrooms.filter(
    (c) =>
      !activeIds.has(c._id) &&
      c.status !== 'completed' &&
      statuses.get(c._id)?.state !== 'completed'
  );

  return {
    active,
    recentByRecency: groupChatroomsByRecency(remaining),
    completed,
  };
}

/** Flatten partitioned listing in sidebar display order (for table view). */
export function flattenPartitionedCurrent(
  partitioned: PartitionedChatroomListing
): ChatroomWithStatus[] {
  return [
    ...partitioned.active,
    ...RECENCY_SECTIONS.flatMap(({ key }) => partitioned.recentByRecency[key]),
  ];
}
