/**
 * Assigned task signals — incremental feed definition for task monitor.
 */

import { parseAssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import type { AssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { IncrementalFeedDef, FeedPage, SubscribeQueryTarget } from '../types.js';

export interface AssignedTaskSignalFeedArgs {
  sessionId: SessionId;
  machineId: string;
}

export const assignedTaskSignalsFeedDef: IncrementalFeedDef<
  AssignedTaskSignal,
  AssignedTaskSignalFeedArgs
> = {
  name: 'assigned-task-signals',
  itemKey: (item) => item.revisionKey,
  parseItem: parseAssignedTaskSignal,
};

export const assignedTaskSignalsSubscribeTarget: SubscribeQueryTarget<
  AssignedTaskSignal,
  AssignedTaskSignalFeedArgs
> = {
  query: api.machines.subscribeAssignedTaskSignalsSince,
  buildArgs: (args, afterKey, limit) => ({
    sessionId: args.sessionId,
    machineId: args.machineId,
    afterKey: afterKey ?? undefined,
    limit,
  }),
  parsePage: (result) => result as FeedPage<AssignedTaskSignal>,
};

export const ASSIGNED_TASK_SIGNAL_FEED_LIMIT = 50;

export const ASSIGNED_TASK_SIGNAL_FEED_BUFFER = {
  maxSize: 200,
  dedupe: true,
};
