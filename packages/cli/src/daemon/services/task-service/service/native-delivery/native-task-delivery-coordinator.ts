import type { Runtime, Context } from 'effect';

import { decideNextDelivery } from './delivery-decision.js';
import {
  logNativeDeliveryDecision,
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import type { TaskDeliveryService } from './task-delivery-service.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { AgentLifecycleFact } from '../../../../domain/entities/agent-lifecycle-fact.js';
import { TaskAssigneeType, type AssignedTask } from '../../../../domain/entities/assigned-task.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../../entry/daemon-services.js';
import type {
  AgentConfigEntry,
  AgentConfigRegistry,
} from '../../../chatroom-workspace-configuration-service/index.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
  NativeDeliverySessionHandles,
} from '../../../service-interfaces.js';

type TaskDeliveryRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskDeliveryContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps extends NativeDeliverySessionHandles {
  convexUrl: string;
}

export type NativeDeliveryDelivered = {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
};

export type NativeDeliveryExecution =
  { kind: 'delivered'; delivered?: NativeDeliveryDelivered } | { kind: 'task-unavailable' };

export type NativeDeliveryExecutors = {
  deliverTask?: (
    task: AssignedTask,
    agentConfig: AgentConfigEntry | undefined
  ) => Promise<NativeDeliveryExecution>;
  /** Legacy compatibility; production uses deliverTask. */
  startAgent?: (task: AssignedTask, agentConfig: AgentConfigEntry | undefined) => Promise<unknown>;
  injectTask?: (
    task: AssignedTask,
    harnessSessionId: string | undefined
  ) => Promise<NativeDeliveryExecution>;
};

type DeliveryPass =
  | 'inbox-signal'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'restart'
  | 'agent-started'
  | 'agent-session-lost'
  | 'turn-ended'
  | 'restart-completed';
type LegacyDeliveryPass = 'inbox-signal' | 'restart';

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  async reconcileRoleTasks(params: {
    tasks: AssignedTask[];
    pass?: DeliveryPass | LegacyDeliveryPass;
    runtime: TaskDeliveryRuntime;
    effectContext: TaskDeliveryContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    runSerializedForAgent: <T>(
      key: AgentKey,
      options: SerializedAgentOperationOptions,
      operation: (
        ops: SerializedAgentOperations,
        context: SerializedAgentOperationContext
      ) => Promise<T>
    ) => Promise<T>;
    taskService: TaskDeliveryService;
    configurationService: AgentConfigRegistry;
    /** Optional config snapshot from TaskService's periodic wakeup. */
    agentConfig?: AgentConfigEntry | undefined;
    sessionDeps: NativeTaskDeliverySessionDeps;
    lifecycleOutbox: {
      enqueue: (fact: AgentLifecycleFact) => Promise<unknown>;
    };
    isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean;
    machineId: string;
    onTaskDelivered?:
      | ((args: {
          chatroomId: string;
          role: string;
          taskId: string;
          harnessSessionId: string;
        }) => void)
      | undefined;
    executors?: NativeDeliveryExecutors;
  }): Promise<void> {
    const tasks = params.tasks;
    if (tasks.length === 0) return;
    const { isTaskActive, onTaskDelivered, executors } = params;
    const deliveryState = getRoleDeliveryState();
    const taskService = params.taskService;

    const groups = new Map<string, AssignedTask[]>();
    for (const task of tasks) {
      const key = `${task.chatroomId}:${task.agentConfig.role.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }

    for (const roleTasks of groups.values()) {
      const sortedTasks = [...roleTasks].sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return a.createdAt - b.createdAt;
      });
      const firstTask = sortedTasks[0];
      if (!firstTask) continue;
      const { role } = firstTask.agentConfig;
      const ephemeralConfig =
        firstTask.assignee?.type === TaskAssigneeType.Ephemeral
          ? firstTask.assignee.ephemeral
          : undefined;
      const agentConfig =
        params.agentConfig ??
        params.configurationService?.get(firstTask.chatroomId, role) ??
        // Legacy/test callers predate the configuration service. Production
        // always resolves configuration through that service.
        ephemeralConfig;
      const activeTaskId = roleTasks.find((candidate) =>
        isTaskActive({ chatroomId: candidate.chatroomId, role, taskId: candidate.taskId })
      )?.taskId;
      const decision = decideNextDelivery(roleTasks, {
        role,
        activeTaskId,
        deliveryInFlight: false,
        agentConfig,
        isNativeHarness: taskService.isNativeHarness,
        explainNativeDeliveryBlock: taskService.explainNativeDeliveryBlock,
      });
      const attemptId = `${Date.now()}-${firstTask.taskId}`;
      const decisionReason = 'reason' in decision ? decision.reason : undefined;
      logNativeDeliveryDecision(
        params.pass ?? 'inbox-signal',
        role,
        firstTask.chatroomId,
        decision.kind === 'failed' || decision.kind === 'waiting'
          ? `${decision.kind}:${decision.reason}`
          : decision.kind,
        'taskId' in decision ? decision.taskId : undefined,
        { ...(decisionReason ? { reason: decisionReason } : {}), attemptId }
      );

      const row =
        ('taskId' in decision
          ? sortedTasks.find((candidate) => candidate.taskId === decision.taskId)
          : firstTask) ?? firstTask;

      if (decision.kind === 'idle' || decision.kind === 'failed' || decision.kind === 'waiting') {
        if (decision.kind !== 'idle') {
          logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        }
        continue;
      }
      if (decision.kind === 'deduplicated') {
        logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        continue;
      }
      if (!deliveryState.tryAcquireDelivery(row.chatroomId, role)) {
        logNativeDeliveryMutexSkip(role, row.chatroomId, row.taskId);
        continue;
      }

      logNativeDeliveryInjecting(role, row.chatroomId, row.taskId);
      if (executors?.deliverTask || executors?.injectTask) {
        try {
          const result = executors.deliverTask
            ? await executors.deliverTask(row, agentConfig)
            : await executors.injectTask?.(
                row,
                params.agentMgr.getSlot(row.chatroomId, role)?.harnessSessionId
              );
          if (!result || result.kind === 'task-unavailable') {
            console.warn(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
            );
          } else if (result.delivered) {
            onTaskDelivered?.(result.delivered);
            deliveryState.clearNativeNudgeFailures(row.chatroomId, role);
            console.log(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=success`
            );
          }
        } catch (error) {
          console.warn(
            `[NativeDelivery:failure] role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject error=${getErrorMessage(error)}`
          );
        } finally {
          deliveryState.releaseDelivery(row.chatroomId, role);
        }
        continue;
      }
      // Legacy/test compatibility only. Production supplies deliverTask, which
      // acquires a ready slot before injecting.
      try {
        const sessionId = params.agentMgr.getSlot(row.chatroomId, role)?.harnessSessionId;
        const full = await taskService.loadAssignedTaskForAction({
          chatroomId: row.chatroomId,
          role: row.agentConfig.role,
          taskId: row.taskId,
        });
        if (!full || !sessionId) {
          console.warn(
            `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
          );
        } else {
          await taskService.deliverNativeTask(full, sessionId, (delivered) => {
            onTaskDelivered?.(delivered);
            deliveryState.clearNativeNudgeFailures(delivered.chatroomId, delivered.role);
          });
        }
      } catch (error) {
        console.warn(
          `[NativeDelivery:failure] role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject error=${getErrorMessage(error)}`
        );
      } finally {
        deliveryState.releaseDelivery(row.chatroomId, role);
      }
    }
  }
}

let coordinator: NativeTaskDeliveryCoordinator | undefined;

export function getNativeTaskDeliveryCoordinator(): NativeTaskDeliveryCoordinator {
  coordinator ??= new NativeTaskDeliveryCoordinator();
  return coordinator;
}

export function resetRoleDeliveryState(chatroomId: string, role: string): void {
  getRoleDeliveryState().resetDeliveryState(chatroomId, role);
}
// fallow-ignore-file complexity
