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

import { logNativeDeliveryTrigger } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import type { TaskDeliveryService } from './task-delivery-service.js';
import type { AgentLifecycleFact } from '../../../../domain/entities/agent-lifecycle-fact.js';
import {
  resolveAgentRuntimeConfig,
  type AssignedTaskSnapshotView,
} from '../../../../domain/entities/assigned-task.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../../../../entry/daemon-services.js';
import type { AgentHarness } from '../../../../entry/daemon-types.js';
import type { AgentProcessManagerService } from '../../../service-interfaces.js';

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
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'agent-session-lost'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';
type LegacyTaskDeliveryPass = 'inbox-signal' | 'restart';

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
  isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const first = options.snapshots[0];
  if (!first) return;
  logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  const executors = {
    startAgent: (task: AssignedTaskSnapshotView) => {
      const runtimeConfig = resolveAgentRuntimeConfig(
        task,
        agentMgr.getSlot(task.chatroomId, task.agentConfig.role)
      );
      if (!runtimeConfig) return Promise.resolve({ success: false, error: 'agent config missing' });
      return runSerializedForAgent(
        { chatroomId: task.chatroomId, role: task.agentConfig.role },
        { timeoutMs: 120_000 },
        (ops, context) =>
          ops.startAgent(
            {
              chatroomId: task.chatroomId,
              role: task.agentConfig.role,
              agentHarness: runtimeConfig.agentHarness as AgentHarness,
              model: runtimeConfig.model ?? '',
              workingDir: runtimeConfig.workingDir,
              reason: AgentStartReasonEnum['platform.pending_task_wake'],
              wantResume: false,
              lifecycleRevision: task.agentConfig.configLifecycleRevision,
              taskId: task.taskId,
            },
            context.signal
          )
      );
    },
    injectTask: async (task: AssignedTaskSnapshotView, harnessSessionId: string | undefined) => {
      const full = await taskService.loadAssignedTaskForAction({
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        taskId: task.taskId,
      });
      if (!full) return { kind: 'task-unavailable' as const };
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
    isTaskActive,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
    executors,
  });
}
