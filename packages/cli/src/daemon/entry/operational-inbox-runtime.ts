// fallow-ignore-file code-duplication complexity
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
  AgentLifecycleOutboxService,
} from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import {
  registerWorkspaceMembershipRefresh,
  unregisterWorkspaceMembershipRefresh,
} from './workspace-membership-refresh-registry.js';
import { api } from '../../api.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import { ackMachineSignal } from '../infrastructure/agent-operational/ack-machine-operational-signals.js';
import { AgentOperationalReadModel } from '../infrastructure/agent-operational/agent-operational-read-model.js';
import { fetchMachineAgentOperationalStatus } from '../infrastructure/agent-operational/fetch-machine-agent-operational-status.js';
import {
  operationalSignalCursorAt,
  runOperationalInbox,
  type OperationalInboxUpdate,
} from '../infrastructure/agent-operational/operational-inbox.js';
import {
  operationalSignalFeeds,
  type OperationalSignalKind,
} from '../infrastructure/agent-operational/operational-signal-feeds.js';
import { createInboxStateStore, resolveInboxDbPath } from '../infrastructure/inbox/index.js';
import {
  type NativeDeliveryService,
  type NativeTaskDeliverySessionDeps,
} from '../services/service-interfaces.js';
import { createAgentTaskStateService } from '../services/service-interfaces.js';

const INBOX_RESTART_INITIAL_MS = 1_000;
const INBOX_RESTART_MAX_MS = 30_000;
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Collision-safe durable cursor scope for one machine/chatroom stream (operational and task). */
function roomScopeKey(machineId: string, chatroomId: string): string {
  return JSON.stringify([machineId, chatroomId]);
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
export const startOperationalInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void; nativeDelivery: NativeDeliveryService },
  never,
  | DaemonSessionService
  | DaemonAgentProcessManagerService
  | DaemonAgentProcessManagerCommandService
  | AgentLifecycleOutboxService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const commandService = yield* DaemonAgentProcessManagerCommandService;
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
    // Operational supervisor: owns machine operational-signal feeds and room watcher
    // membership. The actual task inbox (cursors, snapshots, loops, task-room
    // registration) is implemented by TaskService; entry only calls its facade.
    console.log(
      `[${formatTimestamp()}] 📬 Starting operational-inbox (chatroom-scoped operational signals)`
    );
    const inboxStore = createInboxStateStore(resolveInboxDbPath(session.machineId));
    const serviceStartedAt = Date.now();
    const abort = new AbortController();
    let stopped = false;
    // TaskService owns the task read model and the task-status subscription.
    const agentOperationalReadModel = new AgentOperationalReadModel();
    const agentTaskState = createAgentTaskStateService();
    const nativeDelivery = session.taskService.createNativeDeliveryService({
      runtime,
      effectContext,
      agentMgr,
      runSerializedForAgent: commandService.runSerializedForAgent,
      sessionDeps,
      machineId: session.machineId,
      agentTaskState,
      agentOperationalReadModel,
      lifecycleOutbox,
    });
    yield* Effect.tryPromise(() => session.taskService.startTaskInbox(wsClient)).pipe(
      Effect.catchAll((error) => {
        console.warn('[TaskService] task inbox bootstrap failed:', error);
        return Effect.void;
      })
    );
    const knownRoomIds = new Set<string>();
    const roomWatchers = new Map<
      string,
      { controller: AbortController; startPromise: Promise<void> }
    >();
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

    const operationalHandler = async (
      kind: OperationalSignalKind,
      update: OperationalInboxUpdate
    ): Promise<void> => {
      const chatroomId = update.chatroomId;
      const changed = agentOperationalReadModel.applySignalPage(update.rows, update.removed);
      await Promise.all(
        changed.map(({ chatroomId: roomId, role }) =>
          nativeDelivery.requestReconcile({
            chatroomId: roomId,
            role,
            source: 'operational-signal',
          })
        )
      );
      inboxStore.save(
        {
          inboxType: `operational:${kind}`,
          scopeKey: roomScopeKey(session.machineId, chatroomId),
        },
        { afterSignalKey: update.throughSignalKey }
      );
      try {
        await ackMachineSignal(
          sessionDeps,
          session.machineId,
          chatroomId,
          update.throughSignalKey,
          kind
        );
      } catch (error) {
        console.warn(
          `[OperationalInbox kind=${kind} room=${chatroomId}] signal cleanup failed:`,
          error
        );
      }
    };

    // Sole watcher-creation path: one watcher entry per active chatroom (serving BOTH
    // the operational and task inbox loops). The map entry is installed before any
    // optional hydration so concurrent discoveries cannot start duplicate watchers.
    const ensureRoomInboxes = (chatroomId: string): Promise<void> => {
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
        await Promise.all(
          (['agent-operational', 'agent-stop', 'agent-removal'] as const).map(async (kind) => {
            const operationalRoomKey = {
              inboxType: `operational:${kind}`,
              scopeKey: roomScopeKey(session.machineId, chatroomId),
            };
            const persistedRoom = inboxStore.get<{ afterSignalKey: string }>(operationalRoomKey);
            let cursor = persistedRoom?.state.afterSignalKey;
            if (!cursor) {
              cursor = operationalSignalCursorAt(serviceStartedAt);
              try {
                inboxStore.save(operationalRoomKey, { afterSignalKey: cursor });
              } catch (error) {
                console.warn(
                  `[OperationalInbox kind=${kind} room=${chatroomId}] failed to persist bootstrap baseline:`,
                  error
                );
              }
            }
            if (persistedRoom || bootstrapSucceeded) {
              void ackMachineSignal(sessionDeps, session.machineId, chatroomId, cursor, kind).catch(
                (error) =>
                  console.warn(
                    `[OperationalInbox kind=${kind} room=${chatroomId}] startup signal cleanup failed:`,
                    error
                  )
              );
            }
            void runOperationalInboxLoopWithRestart(
              {
                client: wsClient,
                sessionId: session.sessionId as SessionId,
                machineId: session.machineId,
                chatroomId,
                feed: operationalSignalFeeds[kind],
                serviceStartedAt,
                initialAfterSignalKey: cursor,
                signal: controller.signal,
              },
              (update) => operationalHandler(kind, update),
              () => stopped
            );
          })
        );
        await session.taskService.registerTaskChatroom(chatroomId);
      })();

      return entry.startPromise;
    };

    const refreshRoomMembership = async (): Promise<void> => {
      try {
        const workspaces = await wsClient.query(api.workspaces.listWorkspacesForMachine, {
          sessionId: session.sessionId as SessionId,
          machineId: session.machineId,
        });
        if (stopped) return;
        const chatroomIds = [
          ...new Set((workspaces ?? []).map((workspace) => workspace.chatroomId)),
        ];
        const activeChatroomIds = new Set<string>(chatroomIds);
        for (const [chatroomId, watcher] of roomWatchers) {
          if (activeChatroomIds.has(chatroomId)) continue;
          watcher.controller.abort();
          session.taskService.unregisterTaskChatroom(chatroomId);
          roomWatchers.delete(chatroomId);
          knownRoomIds.delete(chatroomId);
        }
        await Promise.all(chatroomIds.map((chatroomId) => ensureRoomInboxes(chatroomId)));
      } catch (error) {
        console.warn('[WorkspaceMembership] room membership refresh failed:', error);
      }
    };

    registerWorkspaceMembershipRefresh(refreshRoomMembership);

    // Cover membership changes that happened while the daemon was offline or before
    // the command-inbox handler was registered. Later changes arrive through nudges.
    yield* Effect.promise(refreshRoomMembership);

    // Start watchers for rooms known from the operational bootstrap before the first
    // assigned-task bootstrap delivery.
    yield* Effect.tryPromise(() =>
      Promise.all([...knownRoomIds].map((chatroomId) => ensureRoomInboxes(chatroomId)))
    ).pipe(
      Effect.catchAll((error) => {
        console.warn('[OperationalInbox] initial watcher start failed:', error);
        return Effect.void;
      })
    );

    return {
      nativeDelivery,
      stop() {
        stopped = true;
        abort.abort();
        for (const watcher of roomWatchers.values()) {
          watcher.controller.abort();
        }
        unregisterWorkspaceMembershipRefresh();
        session.taskService.stopTaskInbox();
        nativeDelivery.dispose();
        nativeDelivery.agentTaskState.clearAll();
        inboxStore.close();
      },
    };
  });
