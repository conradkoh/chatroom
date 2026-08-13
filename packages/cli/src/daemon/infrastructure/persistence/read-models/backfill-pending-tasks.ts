import type { DatabaseSync } from 'node:sqlite';

import { api } from '../../../../api.js';
import { resolveCanonicalTaskId } from '../../../domain/entities/daemon-task-id.js';
import { upsertTaskReadModel } from './tasks.js';

type ConvexTaskRow = {
  _id: string;
  daemonTaskId?: string;
  chatroomId: string;
  status: string;
  content: string;
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
};

export type BackfillPendingTasksDeps = {
  db: DatabaseSync;
  machineId: string;
  sessionId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  getAgentHarness?: (chatroomId: string, role: string) => Promise<string | undefined>;
};

/** Pull pending Convex tasks for a chatroom/role into the local read model when missing. */
export async function backfillPendingTasksForChatroomRole(
  deps: BackfillPendingTasksDeps,
  chatroomId: string,
  role: string
): Promise<number> {
  const result = (await deps.query(api.tasks.listActiveTasks, {
    sessionId: deps.sessionId,
    chatroomId,
  })) as ConvexTaskRow[] | undefined;

  const targetRole = role.toLowerCase();
  let count = 0;
  const now = Date.now();

  for (const task of result ?? []) {
    if (task.status !== 'pending') continue;
    const assignedRole = (task.assignedTo ?? targetRole).toLowerCase();
    if (assignedRole !== targetRole) continue;

    const harness =
      (await deps.getAgentHarness?.(chatroomId, role)) ?? 'opencode-sdk';

    upsertTaskReadModel(deps.db, {
      chatroomId,
      role,
      taskId: resolveCanonicalTaskId(task),
      status: 'pending',
      taskContent: task.content,
      assignedTo: task.assignedTo ?? role,
      agentHarness: harness,
      machineId: deps.machineId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt ?? now,
    });
    count += 1;
  }

  return count;
}
