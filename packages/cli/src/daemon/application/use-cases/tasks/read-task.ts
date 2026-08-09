// fallow-ignore-file coverage-gaps
import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { buildTaskStatusChangedEvent } from '../../../domain/events/task-events.js';
import {
  listTaskReadModelsForChatroomRole,
  upsertTaskReadModel,
} from '../../../infrastructure/persistence/read-models/tasks.js';

export type MarkTaskInProgressResult =
  | { success: true; status: 'in_progress' }
  | { success: false; code: 'not_found' | 'invalid_status' };

export type MarkTaskInProgressInput = {
  chatroomId: string;
  role: string;
  taskId: string;
};

export type MarkTaskInProgressDeps = {
  db: DatabaseSync;
  machineId: string;
  appendEvent: (event: OutboundEvent) => void;
  now?: () => number;
};

/**
 * Locally transition an acknowledged task to in_progress (P6 task read).
 * Idempotent for already-in_progress tasks (agent recovery). Appends a
 * `task.status_changed` outbound event for idempotent projection to Convex.
 */
export function markTaskInProgress(
  deps: MarkTaskInProgressDeps,
  input: MarkTaskInProgressInput
): MarkTaskInProgressResult {
  const now = deps.now?.() ?? Date.now();
  const tasks = listTaskReadModelsForChatroomRole(deps.db, input.chatroomId, input.role);
  const target = tasks.find((t) => t.taskId === input.taskId);

  if (!target) {
    return { success: false, code: 'not_found' };
  }
  if (target.status !== 'acknowledged' && target.status !== 'in_progress') {
    return { success: false, code: 'invalid_status' };
  }

  if (target.status !== 'in_progress') {
    upsertTaskReadModel(deps.db, { ...target, status: 'in_progress', updatedAt: now });
    deps.appendEvent(
      buildTaskStatusChangedEvent({
        chatroomId: input.chatroomId,
        role: input.role,
        taskId: input.taskId,
        machineId: deps.machineId,
        status: 'in_progress',
        timestamp: now,
      })
    );
  }

  return { success: true, status: 'in_progress' };
}
