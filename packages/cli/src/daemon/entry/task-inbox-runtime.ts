// fallow-ignore-file code-duplication complexity
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  type DaemonAgentProcessManagerServiceShape,
} from './daemon-services.js';
import { AgentLifecycleOutboxService } from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import { api } from '../../api.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery/native-delivery-session-registry.js';
import type { NativeTaskDeliverySessionDeps } from './native-delivery/native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from './native-delivery/task-delivery-processor.js';
import { RecoveryCooldown } from './task-delivery/task-delivery-logic.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import { ackMachineOperationalSignals } from '../infrastructure/agent-operational/ack-machine-operational-signals.js';
import { AgentOperationalReadModel } from '../infrastructure/agent-operational/agent-operational-read-model.js';
import { enrichSnapshotsWithOperational } from '../infrastructure/agent-operational/enrich-snapshot-with-operational.js';
import { fetchMachineAgentOperationalStatus } from '../infrastructure/agent-operational/fetch-machine-agent-operational-status.js';
import {
  operationalSignalCursorAt,
  runOperationalInbox,
  type OperationalInboxUpdate,
} from '../infrastructure/agent-operational/operational-inbox.js';
import { fetchMachineAssignedTaskSnapshots } from '../infrastructure/inbox/fetch-machine-assigned-task-snapshots.js';
import { createInboxStateStore, resolveInboxDbPath } from '../infrastructure/inbox/index.js';
import { handleTaskInboxUpdate } from '../infrastructure/inbox/task-inbox-delivery.js';
import { MachineTaskSnapshotState } from '../infrastructure/inbox/task-snapshot-state.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';

const NATIVE_DELIVERY_RECONCILE_MS = 10_000;
const INBOX_RESTART_INITIAL_MS = 1_000;
const INBOX_RESTART_MAX_MS = 30_000;

type TaskInboxDependencies = {
  sessionDeps: NativeTaskDeliverySessionDeps;
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  cooldown: RecoveryCooldown;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  machineId: string;
  taskSnapshotState?: MachineTaskSnapshotState | undefined;
  /** Invoked with the assigned-task chatroom IDs after task state replace and before first delivery. */
  onDiscoveredChatrooms?: (chatroomIds: string[]) => Promise<void>;
};

// fallow-ignore-next-line unused-export
export async function bootstrapMachineAssignedTaskSnapshots(
  deps: TaskInboxDependencies
): Promise<void> {
  await deps.sessionDeps.backend.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
    sessionId: deps.sessionDeps.sessionId,
    machineId: deps.machineId,
  });
  await deps.sessionDeps.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId: deps.sessionDeps.sessionId,
    machineId: deps.machineId,
  });
  const tasks = await fetchMachineAssignedTaskSnapshots(deps.sessionDeps, deps.machineId);
  deps.taskSnapshotState?.replace(tasks);
  const chatroomIds = [...new Set(tasks.map((task) => task.chatroomId))];
  if (chatroomIds.length > 0) {
    await deps.onDiscoveredChatrooms?.(chatroomIds);
  }
  if (!tasks.length) return;
  await processTasksUpdate(
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    deps.sessionDeps,
    deps.machineId,
    'bootstrap',
    { snapshots: enrichSnapshotsWithOperational(tasks) }
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Collision-safe durable cursor scope for one machine/chatroom operational stream. */
function operationalScopeKey(machineId: string, chatroomId: string): string {
  return JSON.stringify([machineId, chatroomId]);
}

// fallow-ignore-next-line unused-export complexity
export async function runInboxLoopWithRestart(
  options: Parameters<typeof runTaskInbox>[0],
  onUpdate: Parameters<typeof runTaskInbox>[1],
  isStopped: () => boolean
): Promise<void> {
  let backoffMs = INBOX_RESTART_INITIAL_MS;
  while (!isStopped()) {
    try {
      await runTaskInbox(options, onUpdate);
      return;
    } catch (error) {
      if (isStopped() || isAbortError(error)) return;
      console.warn(`[TaskInbox] loop error, restarting in ${backoffMs}ms:`, error);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, INBOX_RESTART_MAX_MS);
    }
  }
}

// fallow-ignore-next-line complexity
async function runOperationalInboxLoopWithRestart(
  options: Parameters<typeof runOperationalInbox>[0],
  onUpdate: Parameters<typeof runOperationalInbox>[1],
  isStopped: () => boolean
): Promise<void> {
  let backoffMs = INBOX_RESTART_INITIAL_MS;
  while (!isStopped()) {
    try {
      await runOperationalInbox(options, onUpdate);
      return;
    } catch (error) {
      if (isStopped() || isAbortError(error)) return;
      console.warn(
        `[OperationalInbox room=${options.chatroomId}] loop error, restarting in ${backoffMs}ms:`,
        error
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, INBOX_RESTART_MAX_MS);
    }
  }
}

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
export const startTaskInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void },
  never,
  DaemonSessionService | DaemonAgentProcessManagerService | AgentLifecycleOutboxService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const lifecycleOutboxService = yield* AgentLifecycleOutboxService;
    const lifecycleOutbox = {
      enqueue: (fact: AgentLifecycleFact) =>
        Effect.runPromise(lifecycleOutboxService.enqueue(fact)),
    };
    const effectContext = yield* Effect.context<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const runtime = yield* Effect.runtime<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      logEvent: session.logEvent,
      backend: {
        mutation: (fn, args) => session.backend.mutation(fn, args),
        query: (fn, args) => session.backend.query(fn, args),
      },
    };
    console.log(
      `[${formatTimestamp()}] 📬 Starting task-inbox (chatroom-scoped operational signals)`
    );
    const inboxStore = createInboxStateStore(resolveInboxDbPath(session.machineId));
    const persisted = inboxStore.get<{ afterSignalKey: string }>({
      inboxType: 'task',
      scopeKey: session.machineId,
    });
    const serviceStartedAt = Date.now();
    const abort = new AbortController();
    let stopped = false;
    const taskSnapshotState = new MachineTaskSnapshotState();
    const agentOperationalReadModel = new AgentOperationalReadModel();
    const knownRoomIds = new Set<string>();
    const roomWatchers = new Map<
      string,
      { controller: AbortController; startPromise: Promise<void> }
    >();
    registerNativeDeliverySession({
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      machineId: session.machineId,
      taskSnapshotState,
      agentOperationalReadModel,
      lifecycleOutbox,
    });
    const cooldown = new RecoveryCooldown();
    let inboxUpdatesInFlight = 0;
    let reconcileInFlight = false;
    const inboxOptions: Parameters<typeof runTaskInbox>[0] = {
      client: wsClient,
      sessionId: session.sessionId as SessionId,
      machineId: session.machineId,
      serviceStartedAt,
      initialAfterSignalKey: persisted?.state.afterSignalKey,
      signal: abort.signal,
    };
    const bootstrapSucceeded = yield* Effect.tryPromise(async () => {
      const rows = await fetchMachineAgentOperationalStatus(sessionDeps, session.machineId);
      agentOperationalReadModel.replace(rows);
      for (const row of rows) knownRoomIds.add(row.chatroomId);
      return true;
    }).pipe(
      Effect.catchAll((error) => {
        console.warn('[OperationalInbox] bootstrap failed:', error);
        return Effect.succeed(false);
      })
    );

    const operationalHandler = async (update: OperationalInboxUpdate): Promise<void> => {
      const chatroomId = update.chatroomId;
      inboxUpdatesInFlight += 1;
      try {
        const changed = agentOperationalReadModel.applySignalPage(update.rows, update.removed);
        const snapshots = changed.flatMap(({ chatroomId: roomId, role }) =>
          taskSnapshotState.listForRole(roomId, role)
        );
        if (snapshots.length > 0) {
          await processTasksUpdate(
            runtime,
            effectContext,
            cooldown,
            agentMgr,
            sessionDeps,
            session.machineId,
            'operational-status',
            { snapshots: enrichSnapshotsWithOperational(snapshots) }
          );
        }
        inboxStore.save(
          {
            inboxType: 'operational',
            scopeKey: operationalScopeKey(session.machineId, chatroomId),
          },
          { afterSignalKey: update.throughSignalKey }
        );
        try {
          await ackMachineOperationalSignals(
            sessionDeps,
            session.machineId,
            chatroomId,
            update.throughSignalKey
          );
        } catch (error) {
          console.warn(`[OperationalInbox room=${chatroomId}] signal cleanup failed:`, error);
        }
      } finally {
        inboxUpdatesInFlight -= 1;
      }
    };

    // Sole watcher-creation path: one watcher per chatroom for the daemon lifetime.
    // The map entry is installed before any optional hydration so concurrent
    // discoveries cannot start duplicate watchers.
    const ensureOperationalInbox = (chatroomId: string): Promise<void> => {
      const existing = roomWatchers.get(chatroomId);
      if (existing) return existing.startPromise;

      const controller = new AbortController();
      const entry: { controller: AbortController; startPromise: Promise<void> } = {
        controller,
        startPromise: Promise.resolve(),
      };
      roomWatchers.set(chatroomId, entry);

      entry.startPromise = (async () => {
        if (!knownRoomIds.has(chatroomId)) {
          try {
            const current = await fetchMachineAgentOperationalStatus(
              sessionDeps,
              session.machineId
            );
            agentOperationalReadModel.replace(current);
            for (const row of current) knownRoomIds.add(row.chatroomId);
          } catch (error) {
            console.warn(
              `[OperationalInbox room=${chatroomId}] operational hydration failed:`,
              error
            );
          }
        }
        const roomKey = {
          inboxType: 'operational' as const,
          scopeKey: operationalScopeKey(session.machineId, chatroomId),
        };
        const persistedRoom = inboxStore.get<{ afterSignalKey: string }>(roomKey);
        let initialCursor: string;
        if (persistedRoom) {
          initialCursor = persistedRoom.state.afterSignalKey;
          void ackMachineOperationalSignals(
            sessionDeps,
            session.machineId,
            chatroomId,
            initialCursor
          ).catch((error) =>
            console.warn(
              `[OperationalInbox room=${chatroomId}] startup signal cleanup failed:`,
              error
            )
          );
        } else if (bootstrapSucceeded) {
          initialCursor = operationalSignalCursorAt(serviceStartedAt);
          // Persist the baseline before acking historical signals skipped by this daemon.
          try {
            inboxStore.save(roomKey, { afterSignalKey: initialCursor });
            void ackMachineOperationalSignals(
              sessionDeps,
              session.machineId,
              chatroomId,
              initialCursor
            ).catch((error) =>
              console.warn(
                `[OperationalInbox room=${chatroomId}] startup signal cleanup failed:`,
                error
              )
            );
          } catch (error) {
            console.warn(
              `[OperationalInbox room=${chatroomId}] failed to persist bootstrap baseline:`,
              error
            );
          }
        } else {
          initialCursor = operationalSignalCursorAt(serviceStartedAt);
        }
        void runOperationalInboxLoopWithRestart(
          {
            client: wsClient,
            sessionId: session.sessionId as SessionId,
            machineId: session.machineId,
            chatroomId,
            serviceStartedAt,
            initialAfterSignalKey: initialCursor,
            signal: controller.signal,
          },
          operationalHandler,
          () => stopped
        );
      })();

      return entry.startPromise;
    };

    // Start watchers for rooms known from the operational bootstrap before the first
    // assigned-task bootstrap delivery.
    yield* Effect.tryPromise(() =>
      Promise.all([...knownRoomIds].map((chatroomId) => ensureOperationalInbox(chatroomId)))
    ).pipe(
      Effect.catchAll((error) => {
        console.warn('[OperationalInbox] initial watcher start failed:', error);
        return Effect.void;
      })
    );

    yield* Effect.tryPromise(() =>
      bootstrapMachineAssignedTaskSnapshots({
        sessionDeps,
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        machineId: session.machineId,
        taskSnapshotState,
        onDiscoveredChatrooms: async (chatroomIds) => {
          await Promise.all(chatroomIds.map((chatroomId) => ensureOperationalInbox(chatroomId)));
        },
      })
    ).pipe(
      Effect.catchAll((error) => {
        console.warn('[TaskInbox] bootstrap failed:', error);
        return Effect.void;
      })
    );

    const inboxHandler: Parameters<typeof runTaskInbox>[1] = async (update) => {
      inboxUpdatesInFlight += 1;
      try {
        const chatroomIds = [
          ...new Set([
            ...update.snapshots.map((snapshot) => snapshot.chatroomId),
            ...update.signals.map((signal) => signal.chatroomId),
          ]),
        ];
        if (chatroomIds.length > 0) {
          await Promise.all(chatroomIds.map((chatroomId) => ensureOperationalInbox(chatroomId)));
        }
        await handleTaskInboxUpdate(update, {
          runtime,
          effectContext,
          cooldown,
          agentMgr,
          sessionDeps,
          machineId: session.machineId,
          taskSnapshotState,
        });
        inboxStore.save(
          { inboxType: 'task', scopeKey: session.machineId },
          { afterSignalKey: update.throughSignalKey }
        );
      } finally {
        inboxUpdatesInFlight -= 1;
      }
    };

    /** Fallback reliability reconcile — primary delivery is reactive via inbox signals. */
    const reconcileTimer = setInterval(() => {
      if (stopped || inboxUpdatesInFlight > 0 || reconcileInFlight) return;
      reconcileInFlight = true;
      void processTasksUpdate(
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        sessionDeps,
        session.machineId,
        'periodic-reconcile',
        { snapshots: enrichSnapshotsWithOperational(taskSnapshotState.listAll()) }
      )
        .catch((error) => {
          console.warn('[TaskInbox] local delivery reconciliation failed:', error);
        })
        .finally(() => {
          reconcileInFlight = false;
        });
    }, NATIVE_DELIVERY_RECONCILE_MS);
    void runInboxLoopWithRestart(inboxOptions, inboxHandler, () => stopped);
    return {
      stop() {
        stopped = true;
        abort.abort();
        for (const watcher of roomWatchers.values()) {
          watcher.controller.abort();
        }
        clearInterval(reconcileTimer);
        unregisterNativeDeliverySession();
        inboxStore.close();
      },
    };
  });
