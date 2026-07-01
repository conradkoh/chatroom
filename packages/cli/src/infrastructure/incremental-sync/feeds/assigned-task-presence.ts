/**
 * Assigned task presence — incremental feed for participant lastSeenAt (nudge timing).
 */

import { parseAssignedTaskPresenceSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import type { AssignedTaskPresenceSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { IncrementalFeedDef, FeedPage, SubscribeQueryTarget } from '../types.js';

export interface AssignedTaskPresenceFeedArgs {
  sessionId: SessionId;
  machineId: string;
}

export const assignedTaskPresenceFeedDef: IncrementalFeedDef<
  AssignedTaskPresenceSignal,
  AssignedTaskPresenceFeedArgs
> = {
  name: 'assigned-task-presence',
  itemKey: (item) => `${item.presenceUpdatedAt}:${item.taskId}:${item.role}`,
  parseItem: parseAssignedTaskPresenceSignal,
};

export const assignedTaskPresenceSubscribeTarget: SubscribeQueryTarget<
  AssignedTaskPresenceSignal,
  AssignedTaskPresenceFeedArgs
> = {
  query: api.machines.subscribeAssignedTaskPresenceSince,
  buildArgs: (args, afterKey, limit) => ({
    sessionId: args.sessionId,
    machineId: args.machineId,
    afterPresenceKey: afterKey ?? undefined,
    limit,
  }),
  parsePage: (result) => {
    const page = result as FeedPage<AssignedTaskPresenceSignal> & {
      highPresenceAt: number | null;
      highPresenceKey: string | null;
    };
    return {
      items: page.items,
      highKey: page.highPresenceKey,
      hasMore: page.hasMore,
    };
  },
};

export const ASSIGNED_TASK_PRESENCE_FEED_LIMIT = 50;

export const ASSIGNED_TASK_PRESENCE_FEED_BUFFER = {
  maxSize: 200,
  dedupe: true,
};
