// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters tasks and delegates ready work to native delivery.
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
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../../../../entry/daemon-services.js';
import type { AgentHarness } from '../../../../entry/daemon-types.js';
import type {
  AgentConfigEntry,
  AgentConfigRegistry,
} from '../../../chatroom-workspace-configuration-service/index.js';
import type { AgentProcessManagerService } from '../../../service-interfaces.js';

export type TaskDeliveryRuntime = Runtime.Runtime<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type TaskDeliveryContext = Context.Context<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type ProcessTasksUpdateOptions = {
  tasks: readonly AssignedTask[];
  /** Snapshot read by TaskService for a periodic task-status wakeup. */
  agentConfig?: AgentConfigEntry | undefined;
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
  configurationService: AgentConfigRegistry,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  pass: TaskDeliveryPass | LegacyTaskDeliveryPass,
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> },
  isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const first = options.tasks[0];
  if (!first) return;
  logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  const executors = {
    startAgent: (task: AssignedTask, agentConfig: AgentConfigEntry | undefined) => {
      if (!agentConfig) return Promise.resolve({ success: false, error: 'agent config missing' });
      return runSerializedForAgent(
        { chatroomId: task.chatroomId, role: task.agentConfig.role },
        { timeoutMs: 120_000 },
        (ops, context) =>
          ops.startAgent(
            {
              chatroomId: task.chatroomId,
              role: task.agentConfig.role,
              agentHarness: agentConfig.agentHarness as AgentHarness,
              model: agentConfig.model ?? '',
              workingDir: agentConfig.workingDir,
              reason: AgentStartReasonEnum['platform.pending_task_wake'],
              wantResume: false,
              taskId: task.taskId,
            },
            context.signal
          )
      );
    },
    injectTask: async (task: AssignedTask, harnessSessionId: string | undefined) => {
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
    tasks: [...options.tasks],
    pass,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent,
    taskService,
    configurationService,
    agentConfig: options.agentConfig,
    sessionDeps,
    lifecycleOutbox,
    isTaskActive,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
    executors,
  });
}
