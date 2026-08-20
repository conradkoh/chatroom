import { NATIVE_DELIVERY_RECONCILE_MS } from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import { Effect, Runtime, type Context } from 'effect';

import { api } from '../../api.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';
import { handleTaskInboxUpdate } from '../infrastructure/inbox/task-inbox-delivery.js';
import { createInboxStateStore, resolveInboxDbPath } from '../infrastructure/inbox/index.js';
import { clearAssignedTaskSnapshots } from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery/native-delivery-session-registry.js';
import type { NativeTaskDeliverySessionDeps } from './native-delivery/native-task-delivery-coordinator.js';
import { NudgeCooldown } from './task-monitor/task-monitor-logic.js';
import { listAssignedTaskSnapshots } from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import { processTasksUpdate } from './task-monitor-runtime.js';

export const startTaskInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<{ stop: () => void }, never, DaemonSessionService | DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const effectContext = yield* Effect.context<DaemonSessionService | DaemonAgentProcessManagerService>();
    const runtime = yield* Effect.runtime<DaemonSessionService | DaemonAgentProcessManagerService>();
    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      logEvent: session.logEvent,
      backend: { mutation: (fn, args) => session.backend.mutation(fn, args), query: (fn, args) => session.backend.query(fn, args) },
    };
    console.log(`[${formatTimestamp()}] 📬 Starting task-inbox (machine-scoped signals)`);
    const inboxStore = createInboxStateStore(resolveInboxDbPath(session.machineId));
    const persisted = inboxStore.get<{ afterSignalKey: string }>({ inboxType: 'task', scopeKey: session.machineId });
    const abort = new AbortController();
    let stopped = false;
    registerNativeDeliverySession({ runtime, effectContext, agentMgr, sessionDeps, machineId: session.machineId });
    const cooldown = new NudgeCooldown();
    const inboxPromise = runTaskInbox(
      { client: wsClient, sessionId: session.sessionId, machineId: session.machineId, serviceStartedAt: Date.now(), initialAfterSignalKey: persisted?.state.afterSignalKey, signal: abort.signal },
      async (update) => {
        await handleTaskInboxUpdate(update, { runtime, effectContext, cooldown, agentMgr, sessionDeps, machineId: session.machineId });
        inboxStore.save({ inboxType: 'task', scopeKey: session.machineId }, { afterSignalKey: update.throughSignalKey });
      }
    );
    const reconcileTimer = setInterval(() => {
      if (stopped) return;
      const snapshots = listAssignedTaskSnapshots();
      if (snapshots.length) void processTasksUpdate(snapshots, runtime, effectContext, cooldown, agentMgr, sessionDeps, session.machineId, 'presence');
    }, NATIVE_DELIVERY_RECONCILE_MS);
    yield* Effect.tryPromise(() => session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, { sessionId: session.sessionId, machineId: session.machineId })).pipe(Effect.catchAll(() => Effect.void));
    void inboxPromise.catch((error) => { if (!stopped) console.warn('[TaskInbox] loop error:', error); });
    return { stop() { stopped = true; abort.abort(); clearInterval(reconcileTimer); unregisterNativeDeliverySession(); inboxStore.close(); clearAssignedTaskSnapshots(); } };
  });
