import type { MachineTaskSnapshotState } from './task-snapshot-state.js';
import type { TaskInboxUpdate } from './task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../entry/daemon-services.js';
import {
  getNativeDeliverySession,
  recordNativeTaskHandedOff,
} from '../../entry/native-delivery/native-delivery-session-registry.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from '../../entry/native-delivery/task-delivery-processor.js';
import type { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';
import { enrichSnapshotsWithOperational } from '../agent-operational/enrich-snapshot-with-operational.js';
import type { AgentProcessManagerService } from '../agent-process-manager/service/index.js';

export type TaskInboxDeliveryDeps = {
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  cooldown: RecoveryCooldown;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  runSerializedForAgent?: AgentProcessManagerService['runSerializedForAgent'];
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
  taskSnapshotState?: MachineTaskSnapshotState | undefined;
};

export async function handleTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: TaskInboxDeliveryDeps
): Promise<void> {
  const taskSnapshotState = deps.taskSnapshotState ?? getNativeDeliverySession()?.taskSnapshotState;
  for (const signal of update.signals) {
    if (signal.taskStatus === 'completed') {
      recordNativeTaskHandedOff({
        chatroomId: signal.chatroomId,
        role: signal.targetRole,
        taskId: signal.taskId,
      });
    }
  }
  taskSnapshotState?.applySignalPage(update.signals, update.snapshots);
  if (update.snapshots.length === 0) return;
  const runSerializedForAgent =
    deps.runSerializedForAgent ?? getNativeDeliverySession()?.runSerializedForAgent;
  if (!runSerializedForAgent) {
    throw new Error('Task inbox delivery requires AgentProcessManagerService coordination');
  }
  await processTasksUpdate(
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    runSerializedForAgent,
    deps.sessionDeps,
    deps.machineId,
    'inbox-signal',
    { snapshots: enrichSnapshotsWithOperational(update.snapshots) }
  );
}
