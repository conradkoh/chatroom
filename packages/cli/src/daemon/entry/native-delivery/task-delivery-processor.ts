// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters snapshots and delegates ready work to native delivery.
 */

import type { Runtime, Context } from 'effect';

import { logNativeDeliveryFallback } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import { filterSnapshotsExcludingRestartInFlight } from '../restart-orchestrator-in-flight.js';
import type { AgentProcessManagerService } from '../../infrastructure/agent-process-manager/service/index.js';

export type TaskDeliveryRuntime = Runtime.Runtime<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type TaskDeliveryContext = Context.Context<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type ProcessTasksUpdateOptions = {
  snapshots: readonly AssignedTaskSnapshotView[];
  onTaskDelivered?: (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }) => void;
};

type TaskDeliveryPass = 'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status';

export async function processTasksUpdate(
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  pass: TaskDeliveryPass,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const filteredTasks = filterSnapshotsExcludingRestartInFlight([...options.snapshots]);
  if (filteredTasks.length === 0) return;

  const first = filteredTasks[0];
  logNativeDeliveryFallback(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: filteredTasks,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent,
    sessionDeps,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
  });
}
