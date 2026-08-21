import type { TaskInboxUpdate } from './task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../entry/daemon-services.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from '../../entry/native-delivery/task-delivery-processor.js';
import type { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';

export type TaskInboxDeliveryDeps = {
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  cooldown: RecoveryCooldown;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
};

export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  if (update.snapshots.length === 0) return;
  await processTasksUpdate(
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    deps.sessionDeps,
    deps.machineId,
    'inbox-signal'
  );
}
