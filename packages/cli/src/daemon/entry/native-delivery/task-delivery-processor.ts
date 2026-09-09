// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters snapshots and delegates ready work to native delivery.
 */

import type { Runtime, Context } from 'effect';

import { logNativeDeliveryFallback, logNativeDeliveryTrigger } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentProcessManagerService, TaskService } from '../../services/service-interfaces.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import { filterSnapshotsExcludingRestartInFlight } from '../restart-orchestrator-in-flight.js';

type TaskDeliveryService = Pick<
  TaskService,
  | 'deliverNativeTask'
  | 'isNativeHarness'
  | 'snapshotRequestsNativeColdSession'
  | 'explainNativeDeliveryBlock'
>;

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

type TaskDeliveryPass =
  | 'task-signal'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'operational-signal'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';
type LegacyTaskDeliveryPass = 'inbox-signal' | 'operational-status' | 'restart';

export async function processTasksUpdate(
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  taskService: TaskDeliveryService,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  pass: TaskDeliveryPass | LegacyTaskDeliveryPass,
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> },
  operationalModel: AgentOperationalReadModel,
  isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const filteredTasks = filterSnapshotsExcludingRestartInFlight([...options.snapshots]);
  if (filteredTasks.length === 0) return;

  const first = filteredTasks[0];
  if (pass === 'periodic-reconcile') {
    logNativeDeliveryFallback(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  } else {
    logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  }
  await getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: filteredTasks,
    pass,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent,
    taskService,
    sessionDeps,
    lifecycleOutbox,
    operationalModel,
    isTaskActive,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
  });
}
