// fallow-ignore-file complexity

import type { WorkspaceTaskInboxEventStatus } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import type { TaskDeliveryFailureReason } from './ports/native-task-delivery.js';
import {
  buildTaskServiceDebugState,
  type TaskServiceDebugState,
} from './task-service-debug-state.js';
import { createPendingTaskReconciliationWatcher } from './watchers/pending-task-reconciliation-watcher.js';
import { createTaskInboxAcknowledgementRetryWatcher } from './watchers/task-inbox-acknowledgement-retry-watcher.js';
import { createTaskInboxDeliveryRetryWatcher } from './watchers/task-inbox-delivery-retry-watcher.js';
import { api } from '../../../../api.js';
import type {
  TaskAssigneeType,
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../domain/entities/assigned-task.js';
import {
  TaskInboxState,
  type TaskInboxStateReader,
  type TaskStateApplicationResult,
} from '../../../infrastructure/inbox/task-inbox-state.js';
import type { AgentConfigRegistry } from '../../chatroom-workspace-configuration-service/index.js';
import {
  mapPendingTaskInboxRows,
  createConvexNativeTaskDeliveryGateway,
} from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';
import {
  type TaskHandoffRepository,
  type TaskHandoffRecord,
} from '../infrastructure/repository/task-handoff-repository.js';

interface WorkspaceTaskInboxEventFields {
  readonly eventId: string;
  readonly machineId: string;
  readonly chatroomId: string;
  readonly taskId: string;
  readonly role: string;
  readonly assignee?:
    | { readonly type: TaskAssigneeType.Permanent }
    | {
        readonly type: TaskAssigneeType.Ephemeral;
        readonly ephemeral: {
          readonly agentHarness: string;
          readonly model: string;
          readonly workingDir: string;
        };
      };
  readonly status: WorkspaceTaskInboxEventStatus;
  readonly createdAt: number;
  readonly processedAt?: number;
  readonly task: AssignedTaskWithContent & {
    readonly createdBy: string;
    readonly sourceMessageId?: string;
    readonly queuePosition: number;
    readonly [key: string]: unknown;
  };
}

export type WorkspaceTaskInboxEvent =
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskAssigned;
    })
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskUpdated;
    })
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskDeleted;
    });

export type TaskServiceNotification =
  | {
      readonly kind: 'bootstrap';
      readonly tasks: readonly AssignedTask[];
    }
  | {
      readonly kind: 'inbox-event';
      readonly event: WorkspaceTaskInboxEvent;
    }
  | {
      /** Safety-net wakeup for a task whose task-record status is still pending. */
      readonly kind: 'periodic-reconcile';
      readonly task: AssignedTask;
    };

export type TaskServiceDeliveryConfirmation = {
  readonly deliveredTaskIds?: readonly string[];
  readonly handledEventIds?: readonly string[];
};

export type TaskServiceListener = (
  notification: TaskServiceNotification
) => Promise<TaskServiceDeliveryConfirmation | void> | TaskServiceDeliveryConfirmation | void;

export interface TaskService {
  /** Loads the initial task inbox state. */
  startTaskInbox(wsClient?: ConvexClient): Promise<void>;
  subscribe(listener: TaskServiceListener): () => void;
  stopTaskInbox(): void;
  listTasksForRole(chatroomId: string, role: string): readonly AssignedTask[];
  listAllTasks(): readonly AssignedTask[];
  /**
   * Daemon-local diagnostic snapshot for one chatroom: the in-memory read model
   * that delivery reads. Server-side models are queried separately by
   * `chatroom debug` via `api.daemon.chatroom.debug`. Never used by the delivery
   * path.
   */
  debugState(chatroomId: string): TaskServiceDebugState;
  readonly taskInboxState: TaskInboxStateReader;
  /**
   * Releases a single in-flight task back to backend `pending` after a native
   * turn failure, then patches the local state from the authoritative
   * backend response. The cache update happens only after backend success.
   */
  recordHandoffOutcome(args: {
    chatroomId: string;
    role: string;
    targetRole: string;
    nextTask?: AssignedTask | undefined;
    taskIds?: readonly string[] | undefined;
  }): Promise<void>;
  getLatestHandoff(chatroomId: string, role: string): Promise<TaskHandoffRecord | null>;
  /** Releases rehydrated in-progress tasks whose latest handoff does not cover them. */
  sweepUncoveredInProgressTasks(): Promise<number>;
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTask['status'];
    updatedAt: number;
  }>;
  loadAssignedTaskForAction(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<AssignedTaskWithContent | null>;
  recordDeliveryFailure(args: {
    taskId: string;
    reason:
      | 'no_agent_config'
      | 'unsupported_harness'
      | 'injection_not_confirmed'
      | 'task_not_deliverable'
      | 'assigned_elsewhere';
  }): Promise<boolean>;
  clearDeliveryFailure(
    taskId: string,
    expectedReason?: TaskDeliveryFailureReason
  ): Promise<boolean>;
}

export interface TaskServiceCompositionDependencies extends NativeDeliverySessionHandles {
  convexUrl: string;
  /** Daemon-local source of the latest agent harness/model/workingDir config. */
  configurationService: AgentConfigRegistry;
  /** Durable latest-handoff repository owned by this task service. */
  handoffRepository: TaskHandoffRepository;
}

export function createTaskService(deps: TaskServiceCompositionDependencies): TaskService {
  const gateway = createConvexNativeTaskDeliveryGateway(deps.backend);
  const handoffRepository = deps.handoffRepository;

  const taskInboxState = new TaskInboxState();
  const listeners = new Set<TaskServiceListener>();
  let stopInboxWatch: (() => void) | undefined;
  let stopTaskStatusWatch: (() => void) | undefined;
  let inboxStopped = false;
  // These in-memory sets prevent duplicate work during this daemon run. A restart
  // intentionally replays any event that was not durably marked as processed.
  const pendingEvents = new Map<string, WorkspaceTaskInboxEvent>();
  const scheduledEventIds = new Set<string>();
  const deliveredEventIds = new Set<string>();
  const taskChains = new Map<string, Promise<void>>();
  const maxBootstrapSweepFailures = 3;
  let bootstrapSweepPending = true;
  let bootstrapSweepFailures = 0;
  let bootstrapSweepInFlight = false;
  let bootstrapSweepPromise: Promise<void> | undefined;

  const sweepUncoveredInProgressTasks = async (): Promise<number> => {
    let released = 0;
    let failures = 0;
    for (const task of taskInboxState.listAll()) {
      if (task.status !== 'in_progress') continue;
      try {
        const handoff = await handoffRepository.getLatest(task.chatroomId, task.agentConfig.role);
        if (handoff?.taskIds.includes(task.taskId)) continue;
        const result = await gateway.releaseTaskAfterTurnFailure({
          sessionId: deps.sessionId,
          chatroomId: task.chatroomId,
          role: task.agentConfig.role,
          taskId: task.taskId,
        });
        taskInboxState.markStatus(
          task.chatroomId,
          task.agentConfig.role,
          task.taskId,
          result.status,
          result.updatedAt
        );
        released += 1;
      } catch (error) {
        failures += 1;
        console.warn(
          `[TaskService] bootstrap task release failed chatroom=${task.chatroomId} task=${task.taskId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    if (failures > 0) throw new Error(`${failures} bootstrap task release(s) failed`);
    return released;
  };

  const runBootstrapSweep = (): Promise<void> => {
    if (!bootstrapSweepPending) return Promise.resolve();
    if (bootstrapSweepInFlight) return bootstrapSweepPromise ?? Promise.resolve();
    bootstrapSweepInFlight = true;
    bootstrapSweepPromise = sweepUncoveredInProgressTasks()
      .then(() => {
        bootstrapSweepPending = false;
        bootstrapSweepFailures = 0;
      })
      .catch((error) => {
        bootstrapSweepFailures += 1;
        if (bootstrapSweepFailures >= maxBootstrapSweepFailures) {
          bootstrapSweepPending = false;
          console.warn('[TaskService] bootstrap sweep giving up after 3 failed attempts');
        } else {
          console.warn(
            `[TaskService] bootstrap sweep failed (attempt ${bootstrapSweepFailures}/3): ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
      .finally(() => {
        bootstrapSweepInFlight = false;
        bootstrapSweepPromise = undefined;
      });
    return bootstrapSweepPromise;
  };

  const notifyForDelivery = async (
    notification: TaskServiceNotification
  ): Promise<TaskServiceDeliveryConfirmation> => {
    const results = await Promise.all(
      [...listeners].map((listener) => Promise.resolve(listener(notification)))
    );
    return {
      deliveredTaskIds: results.flatMap((result) => result?.deliveredTaskIds ?? []),
      handledEventIds: results.flatMap((result) => result?.handledEventIds ?? []),
    };
  };
  const notify = async (notification: TaskServiceNotification): Promise<void> => {
    await notifyForDelivery(notification);
  };

  const applyInboxEvent = (
    event: WorkspaceTaskInboxEvent
  ): TaskStateApplicationResult | 'handled' => {
    if (
      event.eventType === WorkspaceTaskInboxEventType.TaskDeleted ||
      (event.task.status as string) === 'completed'
    ) {
      taskInboxState.remove(event.chatroomId, event.role, event.taskId, event.task.updatedAt);
      return 'handled';
    }

    return taskInboxState.upsert([
      {
        taskId: event.task.taskId,
        chatroomId: event.task.chatroomId,
        status: event.task.status as AssignedTask['status'],
        assignedTo: event.task.assignedTo,
        updatedAt: event.task.updatedAt,
        createdAt: event.task.createdAt,
        requestsNativeColdSession: event.task.startInNewSession,
        agentConfig: {
          role: event.role,
          machineId: event.machineId,
        },
        assignee: event.assignee,
      },
    ]);
  };

  const taskKey = (event: WorkspaceTaskInboxEvent): string =>
    `${event.chatroomId}:${event.role.toLowerCase()}:${event.taskId}`;

  /**
   * Delivery and acknowledgement are separate failure boundaries. If the
   * acknowledgement fails after delivery, retrying it must not redeliver.
   */
  const acknowledgeEvent = async (event: WorkspaceTaskInboxEvent): Promise<void> => {
    try {
      await gateway.markTaskInboxEventProcessed({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        eventId: event.eventId,
      });
    } catch (error) {
      console.warn('[TaskService] task inbox acknowledgement failed:', error);
      acknowledgementRetryWatcher.schedule(event.eventId);
    }
  };

  /** Queue one event behind other events for the same chatroom, role, and task. */
  const scheduleEvent = (event: WorkspaceTaskInboxEvent): Promise<void> => {
    if (
      inboxStopped ||
      deliveredEventIds.has(event.eventId) ||
      scheduledEventIds.has(event.eventId)
    ) {
      return Promise.resolve();
    }

    scheduledEventIds.add(event.eventId);
    const previous = taskChains.get(taskKey(event)) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const application = applyInboxEvent(event);
          if (application === 'handled' || application === 'tombstoned') {
            await gateway.clearDeliveryFailure({
              sessionId: deps.sessionId,
              machineId: deps.machineId,
              taskId: event.taskId,
              expectedReason: 'task_not_deliverable',
            });
            deliveredEventIds.add(event.eventId);
            await acknowledgeEvent(event);
            return;
          }
          if (application === 'stale') {
            await notifyForDelivery({ kind: 'inbox-event', event });
            deliveredEventIds.add(event.eventId);
            await acknowledgeEvent(event);
            return;
          }
          const currentTask = taskInboxState.getForRole(event.chatroomId, event.role, event.taskId);
          if (currentTask?.status === 'pending' || currentTask?.status === 'acknowledged') {
            pendingTaskReconciliationWatcher.watch(currentTask);
          } else {
            pendingTaskReconciliationWatcher.clear(event.chatroomId, event.role, event.taskId);
          }
          const confirmation = await notifyForDelivery({ kind: 'inbox-event', event });
          const handledWithoutDelivery =
            confirmation.handledEventIds?.includes(event.eventId) ?? false;
          const delivered = confirmation.deliveredTaskIds?.includes(event.taskId) ?? false;
          if (!handledWithoutDelivery && !delivered) {
            deliveryRetryWatcher.schedule(event.eventId);
            return;
          }
          deliveredEventIds.add(event.eventId);
        } catch (error) {
          console.warn('[TaskService] task inbox delivery failed:', error);
          deliveryRetryWatcher.schedule(event.eventId);
          return;
        } finally {
          scheduledEventIds.delete(event.eventId);
        }
        await acknowledgeEvent(event);
      });
    taskChains.set(taskKey(event), current);
    void current.finally(() => {
      if (taskChains.get(taskKey(event)) === current) taskChains.delete(taskKey(event));
    });
    return current;
  };

  const deliveryRetryWatcher = createTaskInboxDeliveryRetryWatcher({
    isStopped: () => inboxStopped,
    hasPendingEvent: (eventId) => pendingEvents.has(eventId),
    retry: (eventId) => {
      const event = pendingEvents.get(eventId);
      if (event) void scheduleEvent(event);
    },
  });

  const acknowledgementRetryWatcher = createTaskInboxAcknowledgementRetryWatcher({
    isStopped: () => inboxStopped,
    hasPendingEvent: (eventId) => pendingEvents.has(eventId),
    retry: (eventId) => {
      const event = pendingEvents.get(eventId);
      if (event) void acknowledgeEvent(event);
    },
  });

  const reconcileTaskStatuses = (tasks: readonly AssignedTask[]): void => {
    taskInboxState.reconcileStatuses(tasks);
    runBootstrapSweep();
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'acknowledged') {
        pendingTaskReconciliationWatcher.watch(task);
      } else {
        pendingTaskReconciliationWatcher.clear(task.chatroomId, task.agentConfig.role, task.taskId);
      }
    }
  };

  const pendingTaskReconciliationWatcher = createPendingTaskReconciliationWatcher({
    taskState: taskInboxState,
    notify,
    isStopped: () => inboxStopped,
  });

  /** Reconcile a reactive snapshot and schedule only newly observed events. */
  const reconcilePendingEvents = (events: readonly WorkspaceTaskInboxEvent[]): Promise<void> => {
    const nextIds = new Set(events.map((event) => event.eventId));
    for (const eventId of pendingEvents.keys()) {
      if (!nextIds.has(eventId)) {
        pendingEvents.delete(eventId);
        deliveredEventIds.delete(eventId);
        deliveryRetryWatcher.clear(eventId);
        acknowledgementRetryWatcher.clear(eventId);
      }
    }
    return Promise.all(
      events.map((event) => {
        pendingEvents.set(event.eventId, event);
        return scheduleEvent(event);
      })
    ).then(() => undefined);
  };

  const service: TaskService = {
    startTaskInbox: async (wsClient) => {
      inboxStopped = false;
      try {
        const statusTasks = await gateway.listActiveTaskStatuses({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        reconcileTaskStatuses(statusTasks);
        await runBootstrapSweep();
      } catch (error) {
        bootstrapSweepPending = true;
        console.warn('[TaskService] task-status bootstrap failed:', error);
      }
      if (wsClient && !stopInboxWatch) {
        stopInboxWatch = wsClient.onUpdate(
          api.chatroomWorkspaceTaskInbox.listPending,
          { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
          (rows) => {
            void reconcilePendingEvents(mapPendingTaskInboxRows(rows));
          },
          (error) => console.warn(`[daemon] task-inbox watch error: ${String(error)}`)
        );
        if (!stopTaskStatusWatch) {
          stopTaskStatusWatch = wsClient.onUpdate(
            api.daemon.taskStatus.listActive,
            { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
            (tasks) => reconcileTaskStatuses(tasks as AssignedTask[]),
            (error) => console.warn(`[daemon] task-status watch error: ${String(error)}`)
          );
        }
      } else if (!wsClient) {
        const events = await gateway.listPendingTaskInboxEvents({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        await reconcilePendingEvents(events);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopTaskInbox: () => {
      inboxStopped = true;
      stopInboxWatch?.();
      stopInboxWatch = undefined;
      stopTaskStatusWatch?.();
      stopTaskStatusWatch = undefined;
      pendingEvents.clear();
      scheduledEventIds.clear();
      deliveredEventIds.clear();
      deliveryRetryWatcher.stop();
      acknowledgementRetryWatcher.stop();
      pendingTaskReconciliationWatcher.stop();
      taskChains.clear();
      handoffRepository.close();
    },
    listTasksForRole: (chatroomId, role) => taskInboxState.listForRole(chatroomId, role),
    listAllTasks: () => taskInboxState.listAll(),
    debugState: (chatroomId) => buildTaskServiceDebugState({ taskInboxState, chatroomId }),
    taskInboxState,
    recordHandoffOutcome: async ({
      chatroomId,
      role,
      targetRole,
      nextTask,
      taskIds: providedTaskIds,
    }) => {
      const taskIds =
        providedTaskIds ??
        taskInboxState
          .listForRole(chatroomId, role)
          .filter((task) => task.status === 'acknowledged' || task.status === 'in_progress')
          .map((task) => task.taskId);
      await handoffRepository.record({
        chatroomId,
        role,
        taskIds,
        ...(nextTask?.taskId ? { nextTaskId: nextTask.taskId } : {}),
        targetRole,
        handedOffAt: Date.now(),
      });
      const now = Date.now();
      for (const taskId of taskIds) taskInboxState.remove(chatroomId, role, taskId, now);
      if (nextTask) taskInboxState.upsert([nextTask]);
    },
    getLatestHandoff: (chatroomId, role) => handoffRepository.getLatest(chatroomId, role),
    sweepUncoveredInProgressTasks,
    releaseTaskAfterTurnFailure: async (args) => {
      const result = await gateway.releaseTaskAfterTurnFailure({
        sessionId: deps.sessionId,
        chatroomId: args.chatroomId,
        role: args.role,
        taskId: args.taskId,
      });
      taskInboxState.markStatus(
        args.chatroomId,
        args.role,
        args.taskId,
        result.status,
        result.updatedAt
      );
      const currentTask = taskInboxState.getForRole(args.chatroomId, args.role, args.taskId);
      if (currentTask?.status === 'pending') {
        pendingTaskReconciliationWatcher.watch(currentTask);
      } else {
        pendingTaskReconciliationWatcher.clear(args.chatroomId, args.role, args.taskId);
      }
      return result;
    },
    loadAssignedTaskForAction: async ({ chatroomId, role, taskId }) => {
      const task = await gateway.loadAssignedTaskForAction({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        role,
      });
      return task?.chatroomId === chatroomId ? task : null;
    },
    recordDeliveryFailure: ({ taskId, reason }) =>
      gateway.recordDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        reason,
      }),
    clearDeliveryFailure: (taskId, expectedReason) =>
      gateway.clearDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        ...(expectedReason ? { expectedReason } : {}),
      }),
  };
  return service;
}
