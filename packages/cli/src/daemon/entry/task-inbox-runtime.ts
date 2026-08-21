// fallow-ignore-file code-duplication
import { NATIVE_DELIVERY_RECONCILE_MS } from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  type DaemonAgentProcessManagerServiceShape,
} from './daemon-services.js';
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
import { NudgeCooldown } from './task-delivery/task-delivery-logic.js';
import { fetchMachineAssignedTaskSnapshots } from '../infrastructure/inbox/fetch-machine-assigned-task-snapshots.js';
import { createInboxStateStore, resolveInboxDbPath } from '../infrastructure/inbox/index.js';
import { handleTaskInboxUpdate } from '../infrastructure/inbox/task-inbox-delivery.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';

const INBOX_RESTART_INITIAL_MS = 1_000;
const INBOX_RESTART_MAX_MS = 30_000;

type TaskInboxDependencies = {
  sessionDeps: NativeTaskDeliverySessionDeps;
  runtime: TaskDeliveryRuntime;
  effectContext: TaskDeliveryContext;
  cooldown: RecoveryCooldown;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  machineId: string;
};

// fallow-ignore-next-line unused-export
export async function bootstrapMachineAssignedTaskSnapshots(
  deps: TaskInboxDependencies
): Promise<void> {
  await deps.sessionDeps.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId: deps.sessionDeps.sessionId,
    machineId: deps.machineId,
  });
  const tasks = await fetchMachineAssignedTaskSnapshots(deps.sessionDeps, deps.machineId);
  if (!tasks.length) return;
  await processTasksUpdate(
    deps.runtime,
    deps.effectContext,
    deps.cooldown,
    deps.agentMgr,
    deps.sessionDeps,
    deps.machineId,
    'bootstrap',
    { snapshots: tasks }
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
export const startTaskInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void },
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
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
    console.log(`[${formatTimestamp()}] 📬 Starting task-inbox (machine-scoped signals)`);
    const inboxStore = createInboxStateStore(resolveInboxDbPath(session.machineId));
    const persisted = inboxStore.get<{ afterSignalKey: string }>({
      inboxType: 'task',
      scopeKey: session.machineId,
    });
    const abort = new AbortController();
    let stopped = false;
    registerNativeDeliverySession({
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      machineId: session.machineId,
    });
    const cooldown = new NudgeCooldown();
    const inboxOptions: Parameters<typeof runTaskInbox>[0] = {
      client: wsClient,
      sessionId: session.sessionId as SessionId,
      machineId: session.machineId,
      serviceStartedAt: Date.now(),
      initialAfterSignalKey: persisted?.state.afterSignalKey,
      signal: abort.signal,
    };
    const inboxHandler: Parameters<typeof runTaskInbox>[1] = async (update) => {
      await handleTaskInboxUpdate(update, {
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        sessionDeps,
        machineId: session.machineId,
      });
      inboxStore.save(
        { inboxType: 'task', scopeKey: session.machineId },
        { afterSignalKey: update.throughSignalKey }
      );
    };
    const reconcileTimer = setInterval(() => {
      if (stopped) return;
      void processTasksUpdate(
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        sessionDeps,
        session.machineId,
        'periodic-reconcile'
      );
    }, NATIVE_DELIVERY_RECONCILE_MS);
    yield* Effect.tryPromise(() =>
      bootstrapMachineAssignedTaskSnapshots({
        sessionDeps,
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        machineId: session.machineId,
      })
    ).pipe(
      Effect.catchAll((error) => {
        console.warn('[TaskInbox] bootstrap failed:', error);
        return Effect.void;
      })
    );
    void runInboxLoopWithRestart(inboxOptions, inboxHandler, () => stopped);
    return {
      stop() {
        stopped = true;
        abort.abort();
        clearInterval(reconcileTimer);
        unregisterNativeDeliverySession();
        inboxStore.close();
      },
    };
  });
