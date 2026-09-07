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
import { enrichSnapshotsWithOperational } from '../agent-operational/enrich-snapshot-with-operational.js';
import type { AgentProcessManagerService } from '../agent-process-manager/service/index.js';

/** Temporary adapter for callers that have not yet received NativeDeliveryService. */
export type LegacyTaskInboxDeliveryDeps = {
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  runSerializedForAgent?: AgentProcessManagerService['runSerializedForAgent'];
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
  taskSnapshotState?: MachineTaskSnapshotState | undefined;
};

export async function handleLegacyTaskInboxUpdate(
  update: TaskInboxUpdate,
  deps: LegacyTaskInboxDeliveryDeps
): Promise<void> {
  const taskSnapshotState = deps.taskSnapshotState ?? getNativeDeliverySession()?.taskSnapshotState;
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
    deps.agentMgr,
    runSerializedForAgent,
    deps.sessionDeps,
    deps.machineId,
    'inbox-signal',
    { snapshots: enrichSnapshotsWithOperational(update.snapshots) }
  );
}
