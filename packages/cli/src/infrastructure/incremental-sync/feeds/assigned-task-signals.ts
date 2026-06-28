/**
 * Assigned task signals — incremental feed definition for task monitor.
 */

import type { AssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { IncrementalFeedDef, PollPage, PollRequest } from '../types.js';

export interface AssignedTaskSignalFeedArgs {
  sessionId: SessionId;
  machineId: string;
}

type BackendQuery = (
  fn: typeof api.machines.pollAssignedTaskSignalsSince,
  args: {
    sessionId: AssignedTaskSignalFeedArgs['sessionId'];
    machineId: string;
    afterKey?: string;
    limit: number;
  }
) => Promise<{ items: AssignedTaskSignal[]; highKey: string | null; hasMore: boolean }>;

export function makeAssignedTaskSignalsFeed(
  query: BackendQuery
): IncrementalFeedDef<AssignedTaskSignal, AssignedTaskSignalFeedArgs> {
  return {
    name: 'assigned-task-signals',
    itemKey: (item) => item.revisionKey,
    poll: async (
      req: PollRequest<AssignedTaskSignalFeedArgs>
    ): Promise<PollPage<AssignedTaskSignal>> => {
      const page = await query(api.machines.pollAssignedTaskSignalsSince, {
        sessionId: req.args.sessionId,
        machineId: req.args.machineId,
        afterKey: req.afterKey ?? undefined,
        limit: req.limit,
      });
      return {
        items: page.items,
        highKey: page.highKey,
        hasMore: page.hasMore,
      };
    },
  };
}

/** Default poll + buffer config for task monitor signal channel. */
export const ASSIGNED_TASK_SIGNAL_FEED_POLL = {
  intervalMs: 2_000,
  limit: 50,
  backoff: { initialMs: 1_000, maxMs: 30_000 },
} as const;

export const ASSIGNED_TASK_SIGNAL_FEED_BUFFER = {
  maxSize: 200,
  deliveryMode: 'fifo' as const,
  dedupe: true,
};

/** Reconcile interval — matches PENDING_IDLE_NUDGE_MS in task-monitor-logic. */
export const ASSIGNED_TASK_RECONCILE_INTERVAL_MS = 15_000;
