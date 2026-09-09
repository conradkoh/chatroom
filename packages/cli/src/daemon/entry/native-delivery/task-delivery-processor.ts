// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters snapshots and delegates ready work to native delivery.
 */

import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import type { Runtime, Context } from 'effect';

import { logNativeDeliveryFallback, logNativeDeliveryTrigger } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import { api } from '../../../api.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentProcessManagerService, TaskService } from '../../services/service-interfaces.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import type { AgentHarness } from '../daemon-types.js';

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
  const first = options.snapshots[0];
  if (!first) return;
  if (pass === 'periodic-reconcile') {
    logNativeDeliveryFallback(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  } else {
    logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  }
  const executors = {
    startAgent: (task: AssignedTaskSnapshotView, operationalState: string | undefined) =>
      runSerializedForAgent(
        { chatroomId: task.chatroomId, role: task.agentConfig.role },
        { timeoutMs: 120_000 },
        (ops, context) =>
          ops.startAgent(
            {
              chatroomId: task.chatroomId,
              role: task.agentConfig.role,
              agentHarness: task.agentConfig.agentHarness as AgentHarness,
              model: task.agentConfig.model ?? '',
              workingDir: task.agentConfig.workingDir as string,
              reason:
                operationalState === 'running'
                  ? AgentStartReasonEnum['platform.task_monitor_nudge']
                  : AgentStartReasonEnum['platform.pending_task_wake'],
              wantResume: false,
              lifecycleRevision: task.agentConfig.configLifecycleRevision,
              taskId: task.taskId,
            },
            context.signal
          )
      ),
    injectTask: async (task: AssignedTaskSnapshotView, harnessSessionId: string | undefined) => {
      const backend = (await sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
        sessionId: sessionDeps.sessionId,
        machineId,
        taskId: task.taskId,
        role: task.agentConfig.role,
      })) as Parameters<typeof mapAssignedTaskView>[0] | null;
      if (!backend) return { kind: 'task-unavailable' as const };
      const full = mapAssignedTaskView(backend);
      let delivered:
        | {
            chatroomId: string;
            role: string;
            taskId: string;
            harnessSessionId: string;
          }
        | undefined;
      await taskService.deliverNativeTask(full, harnessSessionId, (result) => {
        delivered = result;
      });
      return { kind: 'delivered' as const, ...(delivered ? { delivered } : {}) };
    },
  };
  await getNativeTaskDeliveryCoordinator().reconcileRoleTasks({
    tasks: [...options.snapshots],
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
    executors,
  });
}
