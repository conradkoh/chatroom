// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters tasks and delegates ready work to native delivery.
 */

import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';

import { logNativeDeliveryTrigger } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type DeliveryPass,
} from './native-task-delivery-coordinator.js';
import type { TaskDeliveryService } from './task-delivery-service.js';
import { TaskAssigneeType } from '../../../../domain/entities/assigned-task.js';
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';
import type { AgentHarness } from '../../../../entry/daemon-types.js';
import type {
  AgentConfigEntry,
  AgentConfigRegistry,
} from '../../../chatroom-workspace-configuration-service/index.js';
import type { AgentProcessManagerService } from '../../../service-interfaces.js';

export type ProcessTasksUpdateOptions = {
  tasks: readonly AssignedTask[];
  onTaskDelivered?: (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }) => void;
};

export async function processTasksUpdate(
  taskService: TaskDeliveryService,
  configurationService: AgentConfigRegistry,
  pass: DeliveryPass,
  isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean,
  options: ProcessTasksUpdateOptions,
  acquireNativeDeliverySlot: AgentProcessManagerService['acquireNativeDeliverySlot']
): Promise<readonly string[]> {
  const first = options.tasks[0];
  if (!first) return [];
  logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  const executors = {
    deliverTask: async (task: AssignedTask, agentConfig: AgentConfigEntry | undefined) => {
      if (!agentConfig) return { kind: 'task-unavailable' as const };
      const startInput = {
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model ?? '',
        workingDir: agentConfig.workingDir,
        reason: AgentStartReasonEnum['platform.pending_task_wake'],
        wantResume: false,
        taskId: task.taskId,
      };
      // Task-borne ephemeral parameters override only harness/model. The
      // task's working directory and all other fields remain workspace-owned.
      const ephemeralOverrides =
        task.assignee?.type === TaskAssigneeType.Ephemeral
          ? {
              agentHarness: task.assignee.ephemeral.agentHarness,
              model: task.assignee.ephemeral.model,
            }
          : undefined;
      const effectiveStartInput = {
        ...startInput,
        ...(ephemeralOverrides ? { overrides: ephemeralOverrides } : {}),
      };
      const slot = await acquireNativeDeliverySlot({
        ...effectiveStartInput,
        timeoutMs: 30_000,
      });
      const full = await taskService.loadAssignedTaskForAction({
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        taskId: task.taskId,
      });
      if (!full || !slot?.harnessSessionId) return { kind: 'task-unavailable' as const };
      let delivered:
        | {
            chatroomId: string;
            role: string;
            taskId: string;
            harnessSessionId: string;
          }
        | undefined;
      await taskService.deliverNativeTask(full, slot.harnessSessionId, (result) => {
        delivered = result;
      });
      if (!delivered)
        return { kind: 'failed' as const, reason: 'injection_not_confirmed' as const };
      return { kind: 'delivered' as const, delivered };
    },
  };
  return getNativeTaskDeliveryCoordinator().reconcileRoleTasks({
    tasks: [...options.tasks],
    pass,
    taskService,
    configurationService,
    isTaskActive,
    onTaskDelivered: options.onTaskDelivered,
    executors,
  });
}
