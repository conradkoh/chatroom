// fallow-ignore-file complexity

import type { WorkspaceTaskInboxEventStatus } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';

import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import type {
  TaskAssigneeType,
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../domain/entities/assigned-task.js';
import {
  TaskInboxState,
  type TaskInboxStateReader,
} from '../../../infrastructure/inbox/task-inbox-state.js';
import { createConvexNativeTaskDeliveryGateway } from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';

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
  startTaskInbox(): Promise<void>;
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
  let inboxPollTimer: ReturnType<typeof setInterval> | undefined;
  let inboxPollInFlight = false;

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

  const pollTaskInbox = async (): Promise<void> => {
    if (inboxPollInFlight) return;
    inboxPollInFlight = true;
    try {
      const events = await gateway.listPendingTaskInboxEvents({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      });
      for (const event of events) {
        if (!applyInboxEvent(event)) continue;
        await notify({ kind: 'inbox-event', event });
        await gateway.markTaskInboxEventProcessed({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          eventId: event.eventId,
        });
      }
    } catch (error) {
      console.warn('[TaskService] task inbox poll failed:', error);
    } finally {
      inboxPollInFlight = false;
    }
  };

  const service: TaskService = {
    startTaskInbox: async () => {
      await pollTaskInbox();
      inboxPollTimer ??= setInterval(() => void pollTaskInbox(), 1_000);
      inboxPollTimer.unref?.();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopTaskInbox: () => {
      if (inboxPollTimer) clearInterval(inboxPollTimer);
      inboxPollTimer = undefined;
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
