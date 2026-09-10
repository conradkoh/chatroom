// fallow-ignore-file complexity

import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import {
  NativeDeliveryService,
  type NativeDeliveryServiceDependencies,
} from './native-delivery/native-delivery-service.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import { TaskOutbox } from './task-outbox.js';
import { api } from '../../../../api.js';
import type { AgentLifecycleFact } from '../../../domain/entities/agent-lifecycle-fact.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../../domain/entities/assigned-task.js';
import { fetchMachineAssignedTaskSnapshots } from '../../../infrastructure/inbox/fetch-machine-assigned-task-snapshots.js';
import {
  createInboxStateStore,
  resolveInboxDbPath,
  type InboxStateStore,
} from '../../../infrastructure/inbox/index.js';
import {
  MachineTaskSnapshotState,
  type TaskSnapshotStateReader,
} from '../../../infrastructure/inbox/task-snapshot-state.js';
import {
  runTaskInbox,
  taskSignalCursorAt,
  type TaskInboxUpdate,
} from '../../../infrastructure/inbox/task.js';
import type { AgentProcessManagerService } from '../../agent-process-contracts.js';
import type { TaskOperationalAgent } from '../domain/entities/operational-agent.js';
import { snapshotRequestsNativeColdSession } from '../domain/usecase/native-cold-session-delivery.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../domain/usecase/native-task-injector-logic.js';
import { createConvexNativeTaskDeliveryGateway } from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../infrastructure/adapters/daemon-audit-port.js';

export type TaskServiceNotification =
  | { readonly kind: 'bootstrap'; readonly snapshots: readonly AssignedTaskSnapshotView[] }
  | { readonly kind: 'inbox'; readonly update: TaskInboxUpdate };

export type TaskServiceListener = (notification: TaskServiceNotification) => Promise<void> | void;

export interface TaskService {
  /** Starts the sole daemon subscription to task-status signals. */
  startTaskInbox(client: ConvexClient): Promise<void>;
  /** Adds a chatroom to the task-inbox subscription set. */
  registerTaskChatroom(chatroomId: string): Promise<void>;
  unregisterTaskChatroom(chatroomId: string): void;
  subscribe(listener: TaskServiceListener): () => void;
  stopTaskInbox(): void;
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
      operational?: TaskOperationalAgent | undefined;
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
  let inboxStore: InboxStateStore | undefined;
  const listeners = new Set<TaskServiceListener>();
  const roomControllers = new Map<string, AbortController>();
  let inboxClient: ConvexClient | undefined;
  let serviceStartedAt = 0;
  let stopped = false;
  const taskOutbox = new TaskOutbox(async (entry) => {
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

  const runRoomInbox = async (
    chatroomId: string,
    initialCursor: string,
    controller: AbortController
  ) => {
    const client = inboxClient;
    if (!client) return;
    let cursor = initialCursor;
    let backoffMs = 1_000;
    while (!stopped && !controller.signal.aborted) {
      try {
        await runTaskInbox(
          {
            client,
            sessionId: deps.sessionId as SessionId,
            machineId: deps.machineId,
            chatroomId,
            serviceStartedAt,
            initialAfterSignalKey: cursor,
            signal: controller.signal,
          },
          async (update) => {
            taskSnapshotState.applySignalPage(update.signals, update.snapshots);
            await notify({ kind: 'inbox', update });
            inboxStore?.save(
              { inboxType: 'task', scopeKey: JSON.stringify([deps.machineId, chatroomId]) },
              { afterSignalKey: update.throughSignalKey }
            );
            cursor = update.throughSignalKey;
          }
        );
        return;
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        console.warn(
          `[TaskInbox room=${chatroomId}] loop error, restarting in ${backoffMs}ms:`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  };

  const registerTaskChatroom = async (chatroomId: string): Promise<void> => {
    if (!inboxClient || !inboxStore || roomControllers.has(chatroomId) || stopped) return;
    const key = {
      inboxType: 'task' as const,
      scopeKey: JSON.stringify([deps.machineId, chatroomId]),
    };
    const persisted = inboxStore.get<{ afterSignalKey: string }>(key);
    const cursor = persisted?.state.afterSignalKey ?? taskSignalCursorAt(serviceStartedAt);
    if (!persisted) inboxStore.save(key, { afterSignalKey: cursor });
    const controller = new AbortController();
    roomControllers.set(chatroomId, controller);
    void runRoomInbox(chatroomId, cursor, controller);
  };

  const service: TaskService = {
    startTaskInbox: async (client) => {
      if (inboxClient) return;
      inboxStore = createInboxStateStore(resolveInboxDbPath(deps.machineId));
      serviceStartedAt = Date.now();
      try {
        await deps.backend.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        await deps.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        const snapshots = await fetchMachineAssignedTaskSnapshots(
          { ...deps, convexUrl: deps.convexUrl },
          deps.machineId
        );
        taskSnapshotState.replace(snapshots);
        inboxClient = client;
        await Promise.all(
          [...new Set(snapshots.map((snapshot) => snapshot.chatroomId))].map((chatroomId) =>
            registerTaskChatroom(chatroomId)
          )
        );
        await notify({ kind: 'bootstrap', snapshots });
      } catch (error) {
        inboxStore?.close();
        inboxStore = undefined;
        throw error;
      }
    },
    registerTaskChatroom,
    unregisterTaskChatroom: (chatroomId) => {
      roomControllers.get(chatroomId)?.abort();
      roomControllers.delete(chatroomId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopTaskInbox: () => {
      stopped = true;
      for (const controller of roomControllers.values()) controller.abort();
      roomControllers.clear();
      taskOutbox.stop();
      inboxStore?.close();
      inboxStore = undefined;
    },
    listTasksForRole: (chatroomId, role) => taskSnapshotState.listForRole(chatroomId, role),
    listAllTasks: () => taskSnapshotState.listAll(),
    taskSnapshotState,
    deliverNativeTask: (task, harnessSessionId, onTaskDelivered) =>
      taskOutbox.enqueue({ task, harnessSessionId, onTaskDelivered }),
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
