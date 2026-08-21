import type { TaskInboxUpdate } from './task.js';
import {
  listAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../entry/daemon-services.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from '../../entry/native-delivery/task-delivery-processor.js';
import type { NudgeCooldown } from '../../entry/task-monitor/task-monitor-logic.js';

export type TaskInboxDeliveryDeps = {
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  cooldown: NudgeCooldown;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
};

export function mergeSnapshotsIntoStore(incoming: readonly AssignedTaskSnapshotView[]): void {
  const byKey = new Map(
    listAssignedTaskSnapshots().map((row) => [`${row.taskId}:${row.agentConfig.role}`, row])
  );
  for (const row of incoming) byKey.set(`${row.taskId}:${row.agentConfig.role}`, row);
  replaceAssignedTaskSnapshots([...byKey.values()]);
}

export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  if (update.snapshots.length === 0) return;
  mergeSnapshotsIntoStore(update.snapshots);
  await processTasksUpdate(
    [...update.snapshots],
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    deps.sessionDeps,
    deps.machineId,
    'signal'
  );
}
