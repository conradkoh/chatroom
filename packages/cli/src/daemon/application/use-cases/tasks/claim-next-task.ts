// fallow-ignore-file coverage-gaps
import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { buildTaskClaimedEvent } from '../../../domain/events/task-events.js';
import { upsertParticipantReadModel } from '../../../infrastructure/persistence/read-models/participants.js';
import {
  listTaskReadModelsForChatroomRole,
  upsertTaskReadModel,
} from '../../../infrastructure/persistence/read-models/tasks.js';

export type ClaimNextTaskResult =
  | { success: true; taskId: string; status: 'acknowledged' }
  | { success: false; code: 'no_pending' | 'already_claimed' };

export type ClaimNextTaskInput = {
  chatroomId: string;
  role: string;
  messageId?: string;
  /** Optional explicit task to claim (recovery path). */
  taskId?: string;
};

export type ClaimNextTaskDeps = {
  db: DatabaseSync;
  machineId: string;
  appendEvent: (event: OutboundEvent) => void;
  now?: () => number;
};

/**
 * Locally claim the next pending task for a role (P6). The claim is applied
 * against the SQLite read model synchronously and a `task.claimed` outbound
 * event is appended for idempotent projection to Convex.
 */
export function claimNextTask(
  deps: ClaimNextTaskDeps,
  input: ClaimNextTaskInput
): ClaimNextTaskResult {
  const now = deps.now?.() ?? Date.now();
  const role = input.role.toLowerCase();
  const tasks = listTaskReadModelsForChatroomRole(deps.db, input.chatroomId, role);

  let target = input.taskId
    ? tasks.find((t) => t.taskId === input.taskId && t.status === 'pending')
    : undefined;
  if (!target) {
    target = tasks
      .filter((t) => t.status === 'pending' && (t.assignedTo ?? t.role).toLowerCase() === role)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  if (!target) {
    return { success: false, code: input.taskId ? 'already_claimed' : 'no_pending' };
  }
  if (target.status !== 'pending') {
    return { success: false, code: 'already_claimed' };
  }

  upsertTaskReadModel(deps.db, { ...target, status: 'acknowledged', updatedAt: now });
  upsertParticipantReadModel(deps.db, {
    chatroomId: input.chatroomId,
    role,
    lastSeenAt: now,
    updatedAt: now,
  });
  deps.appendEvent(
    buildTaskClaimedEvent({
      chatroomId: input.chatroomId,
      role,
      taskId: target.taskId,
      machineId: deps.machineId,
      messageId: input.messageId,
      timestamp: now,
    })
  );

  return { success: true, taskId: target.taskId, status: 'acknowledged' };
}
