import type { MachineTaskSnapshotState } from './task-snapshot-state.js';
import type { TaskInboxUpdate } from './task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../entry/daemon-services.js';
import { getNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
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
  taskSnapshotState?: MachineTaskSnapshotState;
};

export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  const taskSnapshotState = deps.taskSnapshotState ?? getNativeDeliverySession()?.taskSnapshotState;
  taskSnapshotState?.applySignalPage(update.signals, update.snapshots);
  if (update.snapshots.length === 0) return;
  await processTasksUpdate(
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    deps.sessionDeps,
    deps.machineId,
    'inbox-signal',
    { snapshots: update.snapshots }
  );
}
