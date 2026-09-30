// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters tasks and delegates ready work to native delivery.
 */

import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent.js';

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

export type TaskDeliveryLifecycleArgs = {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
};

export type ProcessTasksUpdateOptions = {
  tasks: readonly AssignedTask[];
  onTaskDeliveryStarted?: (args: TaskDeliveryLifecycleArgs) => void;
  onTaskDeliveryFailed?: (
    args: TaskDeliveryLifecycleArgs & { reason: 'injection_not_confirmed' }
  ) => void;
  onTaskDelivered?: (args: TaskDeliveryLifecycleArgs) => void;
  isCurrent?: () => boolean;
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
  const isCurrent = options.isCurrent ?? (() => true);
  logNativeDeliveryTrigger(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  const executors = {
    deliverTask: async (task: AssignedTask, agentConfig: AgentConfigEntry | undefined) => {
      if (!isCurrent()) return { kind: 'cancelled' as const };
      if (!agentConfig) return { kind: 'task-unavailable' as const };
      const startInput = {
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model ?? '',
        workingDir: agentConfig.workingDir,
        reason: AgentStartReasonCode.PLATFORM_PENDING_TASK_WAKE,
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
      const taskLookup = {
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        taskId: task.taskId,
      };
      const fullBeforeSlot = await taskService.loadAssignedTaskForAction(taskLookup);
      if (!isCurrent()) return { kind: 'cancelled' as const };
      if (!fullBeforeSlot) {
        taskService.forgetStaleTask(taskLookup);
        console.warn(
          `[NativeDelivery:stale-task] chatroom=${task.chatroomId} role=${task.agentConfig.role} task=${task.taskId} reason=authoritative_task_missing`
        );
        return { kind: 'task-unavailable' as const, stale: true };
      }
      const slot = await acquireNativeDeliverySlot({
        ...effectiveStartInput,
        timeoutMs: 30_000,
      });
      if (!isCurrent()) return { kind: 'cancelled' as const };
      if (!slot) return { kind: 'agent-not-running' as const };
      const full = await taskService.loadAssignedTaskForAction(taskLookup);
      if (!isCurrent()) return { kind: 'cancelled' as const };
      if (!full) {
        taskService.forgetStaleTask(taskLookup);
        console.warn(
          `[NativeDelivery:stale-task] chatroom=${task.chatroomId} role=${task.agentConfig.role} task=${task.taskId} reason=authoritative_task_missing_after_slot`
        );
        return { kind: 'task-unavailable' as const, stale: true };
      }
      if (!slot?.harnessSessionId) return { kind: 'task-unavailable' as const };
      const delivery: TaskDeliveryLifecycleArgs = {
        chatroomId: task.chatroomId,
        role: task.agentConfig.role,
        taskId: task.taskId,
        harnessSessionId: slot.harnessSessionId,
      };
      if (!isCurrent()) return { kind: 'cancelled' as const };
      options.onTaskDeliveryStarted?.(delivery);

      let delivered: TaskDeliveryLifecycleArgs | undefined;
      try {
        if (!isCurrent()) return { kind: 'cancelled' as const };
        await taskService.deliverNativeTask(
          full,
          slot.harnessSessionId,
          (result) => {
            delivered = result;
          },
          isCurrent
        );
      } catch (error) {
        if (!isCurrent()) return { kind: 'cancelled' as const };
        options.onTaskDeliveryFailed?.({
          ...delivery,
          reason: 'injection_not_confirmed',
        });
        throw error;
      }
      if (!isCurrent()) return { kind: 'cancelled' as const };
      if (!delivered) {
        options.onTaskDeliveryFailed?.({
          ...delivery,
          reason: 'injection_not_confirmed',
        });
        return { kind: 'failed' as const, reason: 'injection_not_confirmed' as const };
      }
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
    isCurrent,
  });
}
