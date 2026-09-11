// fallow-ignore-file complexity

import type {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { Effect } from 'effect';

import {
  NativeDeliveryService,
  type NativeDeliveryServiceDependencies,
} from './native-delivery/native-delivery-service.js';
import { NativeTaskDeliveryQueue } from './native-task-delivery-queue.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import type { AgentLifecycleFact } from '../../../domain/entities/agent-lifecycle-fact.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../../domain/entities/assigned-task.js';
import {
  MachineTaskSnapshotState,
  type TaskSnapshotStateReader,
} from '../../../infrastructure/inbox/task-snapshot-state.js';
import type { AgentProcessManagerService } from '../../agent-process-contracts.js';
import { snapshotRequestsNativeColdSession } from '../domain/usecase/native-cold-session-delivery.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../domain/usecase/native-task-injector-logic.js';
import { createConvexNativeTaskDeliveryGateway } from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../infrastructure/adapters/daemon-audit-port.js';

interface WorkspaceTaskInboxEventFields {
  readonly eventId: string;
  readonly machineId: string;
  readonly chatroomId: string;
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
      readonly eventType: WorkspaceTaskInboxEventType.TaskDeleted;
    });

export type TaskServiceNotification = {
  readonly kind: 'bootstrap';
  readonly snapshots: readonly AssignedTaskSnapshotView[];
};

export type TaskServiceListener = (notification: TaskServiceNotification) => Promise<void> | void;

export interface TaskService {
  /** Loads the daemon's assigned-task snapshot. */
  startTaskInbox(): Promise<void>;
  subscribe(listener: TaskServiceListener): () => void;
  stopTaskInbox(): void;
  listPendingTaskInboxEvents(): Promise<readonly WorkspaceTaskInboxEvent[]>;
  markTaskInboxEventProcessed(eventId: string): Promise<boolean>;
  listTasksForRole(chatroomId: string, role: string): readonly AssignedTaskSnapshotView[];
  listAllTasks(): readonly AssignedTaskSnapshotView[];
  readonly taskSnapshotState: TaskSnapshotStateReader;
  deliverNativeTask(
    task: AssignedTaskWithContent,
    harnessSessionId: string | undefined,
    onTaskDelivered?: (args: {
      chatroomId: string;
      role: string;
      taskId: string;
      harnessSessionId: string;
    }) => void
  ): Promise<void>;
  isNativeHarness(harness: string): boolean;
  /**
   * Releases a single in-flight task back to backend `pending` after a native
   * turn failure, then patches the local snapshot from the authoritative
   * backend response. The cache update happens only after backend success.
   */
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTaskSnapshotView['status'];
    updatedAt: number;
  }>;
  snapshotRequestsNativeColdSession(task: AssignedTaskSnapshotView): boolean;
  loadAssignedTaskForAction(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<AssignedTaskWithContent | null>;
  explainNativeDeliveryBlock(
    task: AssignedTaskSnapshotView,
    options: {
      slot: ReturnType<AgentProcessManagerService['getSlot']>;
    }
  ): string | null;
  createNativeDeliveryService(
    deps: Omit<NativeDeliveryServiceDependencies, 'taskService' | 'taskSnapshotState'>
  ): NativeDeliveryService;
}

export interface TaskServiceCompositionDependencies extends NativeDeliverySessionHandles {
  convexUrl: string;
  agentProcessService: AgentProcessManagerService;
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  onTaskDelivered?: (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }) => void;
}

export function createTaskService(deps: TaskServiceCompositionDependencies): TaskService {
  const gateway = createConvexNativeTaskDeliveryGateway(deps.backend);
  const audit = createDaemonAuditPort(deps.logEvent ?? (async () => undefined));
  const agentMgr = {
    resumeTurnForSlot: (args: { chatroomId: string; role: string; prompt: string }) =>
      deps.agentProcessService.resumeTurnForSlot(args),
    getSlot: (chatroomId: string, role: string) =>
      deps.agentProcessService.getSlot(chatroomId, role),
  };

  const taskSnapshotState = new MachineTaskSnapshotState();
  const listeners = new Set<TaskServiceListener>();
  const nativeTaskDeliveryQueue = new NativeTaskDeliveryQueue(async (entry) => {
    await Effect.runPromise(
      runNativeInjectionEffect(entry.task, entry.harnessSessionId, {
        ...deps,
        agentMgr,
        taskGateway: gateway,
        audit,
        runSerializedForAgent: deps.agentProcessService.runSerializedForAgent,
        onTaskDelivered: entry.onTaskDelivered,
      })
    );
  });

  const notify = async (notification: TaskServiceNotification): Promise<void> => {
    await Promise.all([...listeners].map((listener) => Promise.resolve(listener(notification))));
  };

  const service: TaskService = {
    startTaskInbox: async () => {
      await notify({ kind: 'bootstrap', snapshots: taskSnapshotState.listAll() });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopTaskInbox: () => {
      nativeTaskDeliveryQueue.stop();
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
    listTasksForRole: (chatroomId, role) => taskSnapshotState.listForRole(chatroomId, role),
    listAllTasks: () => taskSnapshotState.listAll(),
    taskSnapshotState,
    deliverNativeTask: (task, harnessSessionId, onTaskDelivered) =>
      nativeTaskDeliveryQueue.enqueue({ task, harnessSessionId, onTaskDelivered }),
    isNativeHarness,
    releaseTaskAfterTurnFailure: async (args) => {
      const result = await gateway.releaseTaskAfterTurnFailure({
        sessionId: deps.sessionId,
        chatroomId: args.chatroomId,
        role: args.role,
        taskId: args.taskId,
      });
      taskSnapshotState.markStatus(
        args.chatroomId,
        args.role,
        args.taskId,
        result.status,
        result.updatedAt
      );
      return result;
    },
    snapshotRequestsNativeColdSession,
    loadAssignedTaskForAction: async ({ chatroomId, role, taskId }) => {
      const task = await gateway.loadAssignedTaskForAction({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        role,
      });
      return task?.chatroomId === chatroomId ? task : null;
    },
    explainNativeDeliveryBlock: (task, options) => explainNativeDeliveryBlock(task, options),
    createNativeDeliveryService: (deliveryDeps) => {
      const nativeDelivery = new NativeDeliveryService({
        ...deliveryDeps,
        taskSnapshotState,
        taskService: service,
      });
      nativeDelivery.startPeriodicReconciliation();
      return nativeDelivery;
    },
  };
  return service;
}
