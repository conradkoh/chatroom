import type { DatabaseSync } from 'node:sqlite';

import {
  listAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getNativeTaskDeliveryCoordinator } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import { getAgentReadModel } from '../../infrastructure/persistence/read-models/agents.js';
import { upsertTaskReadModel } from '../../infrastructure/persistence/read-models/tasks.js';
import type { AssignedTaskSnapshotView } from '../entities/assigned-task.js';
import type { InboundEvent } from '../entities/inbound-event.js';

export type UserMessageIntentInboundEvent = Extract<InboundEvent, { type: 'user-message.intent' }>;

export type HandleUserMessageIntentInboundDeps = {
  /** Wired by start-daemon (P7). Absent → intent ingest is a no-op (flag off / tests). */
  db?: DatabaseSync;
  machineId: string;
};

function mergeIntentSnapshot(
  db: DatabaseSync,
  deps: HandleUserMessageIntentInboundDeps,
  event: UserMessageIntentInboundEvent,
  now: number
): void {
  const agent = getAgentReadModel(db, deps.machineId, event.role);
  const existing = listAssignedTaskSnapshots();
  const existingForTask = existing.find(
    (row) => row.taskId === event.taskId && row.chatroomId === event.chatroomId
  );

  const merged: AssignedTaskSnapshotView = existingForTask
    ? { ...existingForTask, status: 'pending', assignedTo: event.role }
    : {
        taskId: event.taskId,
        chatroomId: event.chatroomId,
        status: 'pending',
        assignedTo: event.role,
        updatedAt: now,
        createdAt: event.createdAt,
        agentConfig: {
          role: event.role,
          machineId: deps.machineId,
          agentHarness: event.agentHarness,
          workingDir: event.workingDir,
          model: event.model,
          spawnedAgentPid: agent?.pid,
          desiredState: 'running',
        },
      };

  replaceAssignedTaskSnapshots([
    ...existing.filter(
      (row) => !(row.taskId === event.taskId && row.chatroomId === event.chatroomId)
    ),
    merged,
  ]);
}

/**
 * P7 user-message intent ingest. Upserts the pending task into the SQLite read
 * model, merges a snapshot row into the assigned-task store, and wakes the
 * native delivery coordinator so a running native agent can inject the task.
 */
export function handleUserMessageIntentInbound(
  deps: HandleUserMessageIntentInboundDeps,
  event: UserMessageIntentInboundEvent
): void {
  if (!deps.db) return;
  const now = Date.now();

  upsertTaskReadModel(deps.db, {
    chatroomId: event.chatroomId,
    role: event.role,
    taskId: event.taskId,
    status: 'pending',
    assignedTo: event.role,
    agentHarness: event.agentHarness,
    machineId: deps.machineId,
    workingDir: event.workingDir,
    model: event.model,
    createdAt: event.createdAt,
    updatedAt: now,
  });

  mergeIntentSnapshot(deps.db, deps, event, now);

  getNativeTaskDeliveryCoordinator().tryInjectNextForRole(event.chatroomId, event.role);
}
