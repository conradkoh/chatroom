// fallow-ignore-file complexity

import type { WorkspaceTaskInboxEventStatus } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import { api } from '../../../../api.js';
import type {
  TaskAssigneeType,
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../domain/entities/assigned-task.js';
import {
  TaskInboxState,
  type TaskInboxStateReader,
} from '../../../infrastructure/inbox/task-inbox-state.js';
import {
  mapPendingTaskInboxRows,
  createConvexNativeTaskDeliveryGateway,
} from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';

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
    };

export type TaskServiceListener = (notification: TaskServiceNotification) => Promise<void> | void;

export interface TaskService {
  /** Loads the initial task inbox state. */
  startTaskInbox(wsClient?: ConvexClient): Promise<void>;
  subscribe(listener: TaskServiceListener): () => void;
  stopTaskInbox(): void;
  listPendingTaskInboxEvents(): Promise<readonly WorkspaceTaskInboxEvent[]>;
  markTaskInboxEventProcessed(eventId: string): Promise<boolean>;
  listTasksForRole(chatroomId: string, role: string): readonly AssignedTask[];
  listAllTasks(): readonly AssignedTask[];
  readonly taskInboxState: TaskInboxStateReader;
  /**
   * Releases a single in-flight task back to backend `pending` after a native
   * turn failure, then patches the local state from the authoritative
   * backend response. The cache update happens only after backend success.
   */
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
}

export interface TaskServiceCompositionDependencies extends NativeDeliverySessionHandles {
  convexUrl: string;
}

export function createTaskService(deps: TaskServiceCompositionDependencies): TaskService {
  const gateway = createConvexNativeTaskDeliveryGateway(deps.backend);

  const taskInboxState = new TaskInboxState();
  const listeners = new Set<TaskServiceListener>();
  let stopInboxWatch: (() => void) | undefined;
  let inboxStopped = false;
  const pendingEvents = new Map<string, WorkspaceTaskInboxEvent>();
  const scheduledEventIds = new Set<string>();
  const deliveredEventIds = new Set<string>();
  const deliveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const acknowledgementRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const taskChains = new Map<string, Promise<void>>();

  const notify = async (notification: TaskServiceNotification): Promise<void> => {
    await Promise.all([...listeners].map((listener) => Promise.resolve(listener(notification))));
  };

  const applyInboxEvent = (event: WorkspaceTaskInboxEvent): boolean => {
    if (
      event.eventType === WorkspaceTaskInboxEventType.TaskDeleted ||
      (event.task.status as string) === 'completed'
    ) {
      taskInboxState.remove(event.chatroomId, event.role, event.taskId);
      return true;
    }

    taskInboxState.upsert([
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
    return true;
  };

  const taskKey = (event: WorkspaceTaskInboxEvent): string =>
    `${event.chatroomId}:${event.role.toLowerCase()}:${event.taskId}`;

  const retryDelivery = (eventId: string): void => {
    if (inboxStopped || deliveryRetryTimers.has(eventId) || !pendingEvents.has(eventId)) return;
    const timer = setTimeout(() => {
      deliveryRetryTimers.delete(eventId);
      const event = pendingEvents.get(eventId);
      if (event) scheduleEvent(event);
    }, 1_000);
    deliveryRetryTimers.set(eventId, timer);
    timer.unref?.();
  };

  const retryAcknowledgement = (eventId: string): void => {
    if (inboxStopped || acknowledgementRetryTimers.has(eventId) || !pendingEvents.has(eventId)) {
      return;
    }
    const timer = setTimeout(() => {
      acknowledgementRetryTimers.delete(eventId);
      const event = pendingEvents.get(eventId);
      if (event) void acknowledgeEvent(event);
    }, 1_000);
    acknowledgementRetryTimers.set(eventId, timer);
    timer.unref?.();
  };

  const acknowledgeEvent = async (event: WorkspaceTaskInboxEvent): Promise<void> => {
    try {
      await gateway.markTaskInboxEventProcessed({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        eventId: event.eventId,
      });
    } catch (error) {
      console.warn('[TaskService] task inbox acknowledgement failed:', error);
      retryAcknowledgement(event.eventId);
    }
  };

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
          if (!applyInboxEvent(event)) return;
          await notify({ kind: 'inbox-event', event });
          deliveredEventIds.add(event.eventId);
        } catch (error) {
          console.warn('[TaskService] task inbox delivery failed:', error);
          retryDelivery(event.eventId);
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

  const reconcilePendingEvents = (events: readonly WorkspaceTaskInboxEvent[]): Promise<void> => {
    const nextIds = new Set(events.map((event) => event.eventId));
    for (const eventId of pendingEvents.keys()) {
      if (!nextIds.has(eventId)) {
        pendingEvents.delete(eventId);
        deliveredEventIds.delete(eventId);
        const deliveryTimer = deliveryRetryTimers.get(eventId);
        if (deliveryTimer) clearTimeout(deliveryTimer);
        deliveryRetryTimers.delete(eventId);
        const acknowledgementTimer = acknowledgementRetryTimers.get(eventId);
        if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
        acknowledgementRetryTimers.delete(eventId);
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
      if (wsClient && !stopInboxWatch) {
        stopInboxWatch = wsClient.onUpdate(
          api.chatroomWorkspaceTaskInbox.listPending,
          { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
          (rows) => {
            void reconcilePendingEvents(mapPendingTaskInboxRows(rows));
          },
          (error) => console.warn(`[daemon] task-inbox watch error: ${String(error)}`)
        );
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
      pendingEvents.clear();
      scheduledEventIds.clear();
      deliveredEventIds.clear();
      for (const timer of deliveryRetryTimers.values()) clearTimeout(timer);
      deliveryRetryTimers.clear();
      for (const timer of acknowledgementRetryTimers.values()) clearTimeout(timer);
      acknowledgementRetryTimers.clear();
      taskChains.clear();
    },
    listPendingTaskInboxEvents: () =>
      gateway.listPendingTaskInboxEvents({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      }),
    markTaskInboxEventProcessed: (eventId) =>
      gateway.markTaskInboxEventProcessed({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        eventId,
      }),
    listTasksForRole: (chatroomId, role) => taskInboxState.listForRole(chatroomId, role),
    listAllTasks: () => taskInboxState.listAll(),
    taskInboxState,
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
  };
  return service;
}
