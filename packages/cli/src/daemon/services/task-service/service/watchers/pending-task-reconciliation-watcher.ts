import { NATIVE_DELIVERY_RECONCILE_MS } from '@workspace/backend/config/reliability.js';

import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';
import type { TaskInboxStateReader } from '../../../../infrastructure/inbox/task-inbox-state.js';
import type {
  AgentConfigEntry,
  AgentConfigRegistry,
} from '../../../chatroom-workspace-configuration-service/index.js';

export interface PendingTaskReconciliationWatcher {
  /** Starts a 10-second fallback timer for a deliverable task if absent already. */
  watch(task: AssignedTask): void;
  /** Stops the fallback timer for one task identity. */
  clear(chatroomId: string, role: string, taskId: string): void;
  /** Stops all task timers when the task service shuts down. */
  stop(): void;
}

/**
 * Watches task-record status for delivery fallback.
 *
 * This is not a task-inbox-event retry. It is a per-task safety net: while a
 * task remains `pending` or `acknowledged`, every 10-second tick reads the current task from the
 * daemon task state and the latest agent configuration, then emits a normal
 * reconciliation notification. It stops as soon as the task is removed or
 * changes status, so lifecycle events remain the fast path and this watcher
 * only provides recovery when an event was missed or a transient operation
 * failed.
 */
export function createPendingTaskReconciliationWatcher(deps: {
  taskState: TaskInboxStateReader;
  configurationService: AgentConfigRegistry;
  notify: (notification: {
    readonly kind: 'periodic-reconcile';
    readonly task: AssignedTask;
    readonly agentConfig: AgentConfigEntry | undefined;
  }) => Promise<void>;
  isStopped: () => boolean;
}): PendingTaskReconciliationWatcher {
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const taskKey = (chatroomId: string, role: string, taskId: string): string =>
    `${chatroomId}:${role.toLowerCase()}:${taskId}`;

  const clear = (chatroomId: string, role: string, taskId: string): void => {
    const key = taskKey(chatroomId, role, taskId);
    const timer = timers.get(key);
    if (timer) clearInterval(timer);
    timers.delete(key);
  };

  return {
    // fallow-ignore-next-line complexity
    watch: (task) => {
      if (task.status !== 'pending' && task.status !== 'acknowledged') return;
      const key = taskKey(task.chatroomId, task.agentConfig.role, task.taskId);
      if (timers.has(key)) return;

      // fallow-ignore-next-line complexity
      const timer = setInterval(() => {
        const currentTask = deps.taskState.getForRole(
          task.chatroomId,
          task.agentConfig.role,
          task.taskId
        );
        if (
          deps.isStopped() ||
          !currentTask ||
          (currentTask.status !== 'pending' && currentTask.status !== 'acknowledged')
        ) {
          clear(task.chatroomId, task.agentConfig.role, task.taskId);
          return;
        }

        void deps
          .notify({
            kind: 'periodic-reconcile',
            task: currentTask,
            agentConfig: deps.configurationService.get(
              currentTask.chatroomId,
              currentTask.agentConfig.role
            ),
          })
          .catch((error: unknown) => {
            console.warn('[TaskService] periodic task reconciliation failed:', error);
          });
      }, NATIVE_DELIVERY_RECONCILE_MS);
      timer.unref?.();
      timers.set(key, timer);
    },
    clear,
    stop: () => {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    },
  };
}
