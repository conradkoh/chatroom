/**
 * Task Monitor — indexed snapshot projection + WS signal/presence subscribe.
 *
 * - Snapshot store: subscribed via wsClient.onUpdate (no HTTP poll on timer)
 * - Periodic reconcile reads the local store
 * - Signal feed: revisionKey cursor — revive/inject
 * - Presence feed: presenceUpdatedAt cursor — nudge timing (replaces 15s reconcile poll)
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import { NATIVE_DELIVERY_RECONCILE_MS } from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { roleSupportsSessionAugmentation } from '@workspace/backend/src/domain/entities/team-agent-settings.js';
import {
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskView,
  ListMachineAssignedTaskSnapshotsResult,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import type { ConvexClient } from 'convex/browser';
import { Effect, Runtime, type Context } from 'effect';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import { logNativeDeliveryFallback } from './native-delivery-log.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery-session-registry.js';
import { isAgentReadyForNativeDelivery } from './native-ready-invariant.js';
import {
  getNativeTaskDeliveryCoordinator,
  resetRoleDeliveryState,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import { isNativeHarness } from './native-task-injector-logic.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import {
  listTasksReadyForNudge,
  listNativeTasksNeedingRevive,
  NudgeCooldown,
  shouldEscalateNativeNudgeToRestart,
} from './task-monitor-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import {
  runDualChannelFeedLive,
  runIncrementalSubscribeLive,
} from '../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  ASSIGNED_TASK_PRESENCE_FEED_BUFFER,
  ASSIGNED_TASK_PRESENCE_FEED_LIMIT,
  assignedTaskPresenceFeedDef,
  assignedTaskPresenceSubscribeTarget,
} from '../../../infrastructure/incremental-sync/feeds/assigned-task-presence.js';
import {
  ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
  ASSIGNED_TASK_SIGNAL_FEED_LIMIT,
  assignedTaskSignalsFeedDef,
  assignedTaskSignalsSubscribeTarget,
} from '../../../infrastructure/incremental-sync/feeds/assigned-task-signals.js';
import {
  clearAssignedTaskSnapshots,
  hasAssignedTaskSnapshot,
  listAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

type TaskMonitorPass = 'signal' | 'presence';

async function seedSignalCursor(session: {
  sessionId: string;
  machineId: string;
  backend: { query: (fn: unknown, args: unknown) => Promise<unknown> };
}): Promise<string | null> {
  const seedPage = (await session.backend.query(api.machines.subscribeAssignedTaskSignalsSince, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    limit: ASSIGNED_TASK_SIGNAL_FEED_LIMIT,
  })) as { highKey: string | null } | null;
  return seedPage?.highKey ?? null;
}

async function seedPresenceCursor(session: {
  sessionId: string;
  machineId: string;
  backend: { query: (fn: unknown, args: unknown) => Promise<unknown> };
}): Promise<string | null> {
  const seedPage = (await session.backend.query(api.machines.subscribeAssignedTaskPresenceSince, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    limit: ASSIGNED_TASK_PRESENCE_FEED_LIMIT,
  })) as { highPresenceKey: string | null } | null;
  return seedPage?.highPresenceKey ?? null;
}

function resolveTaskWantResume(task: AssignedTaskView): boolean {
  return sessionAugmentationToWantResume(
    resolveSessionAugmentationForRole(task.taskContent ?? '', task.agentConfig.role)
  );
}

function buildCliNudgeLogLine(task: AssignedTaskView): string {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';
  const augmentationMode = resolveSessionAugmentationForRole(task.taskContent ?? '', role);
  const wantResume = resolveTaskWantResume(task);
  return `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}, session_augmentation=${augmentationMode}, wantResume=${wantResume}`;
}

function resolveTaskRunnerContextFromFull(task: AssignedTaskView):
  | {
      chatroomId: string;
      agentConfig: AssignedTaskView['agentConfig'];
      role: string;
      workingDir: string;
      wantResume: boolean;
    }
  | undefined {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const workingDir = agentConfig.workingDir;
  if (!workingDir) return undefined;
  return {
    chatroomId,
    agentConfig,
    role,
    workingDir,
    wantResume: resolveTaskWantResume(task),
  };
}

function executeCliNudge(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;
  const augmentationMode = resolveSessionAugmentationForRole(task.taskContent ?? '', role);

  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* agentMgr.stop({ chatroomId, role, reason: 'platform.task_monitor_nudge' });
      yield* agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model,
        workingDir,
        reason: 'platform.task_monitor_nudge',
        wantResume,
      });
      if (roleSupportsSessionAugmentation(role)) {
        yield* Effect.tryPromise({
          try: () =>
            sessionDeps.backend.mutation(api.machines.emitSessionAugmented, {
              sessionId: sessionDeps.sessionId,
              machineId,
              chatroomId,
              role,
              taskId: task.taskId,
              mode: augmentationMode,
              newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
            }),
          catch: (err) => err,
        }).pipe(Effect.catchAll(() => Effect.void));
      }
    }).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] nudge failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

function runNativeReviveEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;

  console.log(
    `[TaskMonitor] native revive ${role}@${chatroomId} — backend PID stale or missing locally for pending task ${task.taskId}`
  );

  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model,
        workingDir,
        reason: 'platform.task_monitor_nudge',
        wantResume,
      });
    }).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] native revive failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

async function fetchHydrateRows(session: {
  sessionId: string;
  machineId: string;
  backend: { query: (fn: unknown, args: unknown) => Promise<unknown> };
}): Promise<AssignedTaskSnapshotView[]> {
  const hydrate = (await session.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: session.sessionId,
    machineId: session.machineId,
  })) as ListMachineAssignedTaskSnapshotsResult;
  return parseAssignedTaskMonitorRows(hydrate.tasks ?? []);
}

async function fetchTaskForAction(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  snapshotRow: AssignedTaskSnapshotView
): Promise<AssignedTaskView | null> {
  const result = (await sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
    sessionId: sessionDeps.sessionId,
    machineId,
    taskId: snapshotRow.taskId,
    role: snapshotRow.agentConfig.role,
  })) as AssignedTaskView | null;
  return result;
}

function runCliNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): void {
  console.log(buildCliNudgeLogLine(task));
  executeCliNudge(task, runtime, effectContext, agentMgr, sessionDeps, machineId);
}

async function clearStuckStoppingSlotIfNeeded(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  chatroomId: string,
  role: string
): Promise<void> {
  const cleared = await agentMgr.clearStuckStoppingSlot(chatroomId, role);
  if (cleared) {
    console.log(`[TaskMonitor] cleared stuck stopping slot for ${role}@${chatroomId}`);
  }
}

async function nudgeStuckTasks(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: NudgeCooldown,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  const getSlot = (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role);

  for (const row of listTasksReadyForNudge(tasks, now, cooldown, getSlot)) {
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);

    if (isNativeHarness(row.agentConfig.agentHarness)) {
      const { chatroomId, agentConfig } = row;
      const { role } = agentConfig;
      const deliveryState = getRoleDeliveryState();
      const failures = deliveryState.recordNativeNudgeFailure(chatroomId, role);

      if (shouldEscalateNativeNudgeToRestart(chatroomId, role, failures)) {
        const full = await fetchTaskForAction(sessionDeps, machineId, row);
        if (!full) continue;
        console.log(
          `[TaskMonitor] native nudge escalate restart ${role}@${chatroomId} — pending task ${row.taskId}`
        );
        runCliNudgeEffect(full, runtime, effectContext, agentMgr, sessionDeps, machineId);
        deliveryState.clearNativeNudgeFailures(chatroomId, role);
        continue;
      }

      resetRoleDeliveryState(chatroomId, role);
      await sessionDeps.backend.mutation(api.participants.join, {
        sessionId: sessionDeps.sessionId,
        chatroomId,
        role,
        action: NATIVE_WAITING_ACTION,
      });
      console.log(
        `[TaskMonitor] native light nudge ${role}@${chatroomId} — redeliver pending task ${row.taskId}`
      );
      logNativeDeliveryFallback('native-light-nudge', role, chatroomId, row.taskId);
      getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
        tasks: [row],
        runtime,
        effectContext,
        agentMgr,
        sessionDeps,
        machineId,
      });
      continue;
    }

    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runCliNudgeEffect(full, runtime, effectContext, agentMgr, sessionDeps, machineId);
  }
}

async function reviveNativeTasks(
  tasks: AssignedTaskSnapshotView[],
  localHealth: {
    getSlot: (
      chatroomId: string,
      role: string
    ) => ReturnType<DaemonAgentProcessManagerServiceShape['getSlot']>;
    isPidAlive: (pid: number) => boolean;
  },
  now: number,
  cooldown: NudgeCooldown,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const row of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runNativeReviveEffect(full, runtime, effectContext, agentMgr);
  }
}

async function processTasksUpdate(
  tasks: AssignedTaskSnapshotView[],
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  cooldown: NudgeCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  _pass: TaskMonitorPass
): Promise<void> {
  if (tasks.length === 0) return;

  const now = Date.now();
  const localHealth = {
    getSlot: (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role),
    isPidAlive: (pid: number) => isProcessAlive((p) => process.kill(p, 0), pid),
  };

  await reviveNativeTasks(
    tasks,
    localHealth,
    now,
    cooldown,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId
  );
  if (tasks.length > 0) {
    const first = tasks[0];
    logNativeDeliveryFallback(
      'signal-presence',
      first.agentConfig.role,
      first.chatroomId,
      first.taskId
    );
  }
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId,
  });
  await nudgeStuckTasks(
    tasks,
    now,
    cooldown,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId
  );
}

function listDeliverablePendingFromStore(
  agentMgr: DaemonAgentProcessManagerServiceShape
): AssignedTaskSnapshotView[] {
  if (!hasAssignedTaskSnapshot()) return [];
  return listAssignedTaskSnapshots().filter((row) => {
    if (row.status !== 'pending') return false;
    const slot = agentMgr.getSlot(row.chatroomId, row.agentConfig.role);
    return isAgentReadyForNativeDelivery(row, slot);
  });
}

function runLocalStoreReconcilePass(params: {
  stopped: boolean;
  monitorPassInFlight: boolean;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  runtime: TaskMonitorRuntime;
  effectContext: TaskMonitorContext;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
}): void {
  const { stopped, monitorPassInFlight, agentMgr, runtime, effectContext, sessionDeps, machineId } =
    params;
  if (stopped || monitorPassInFlight) return;
  const deliverable = listDeliverablePendingFromStore(agentMgr);
  if (deliverable.length === 0) return;
  const first = deliverable[0];
  logNativeDeliveryFallback(
    'periodic-reconcile',
    first.agentConfig.role,
    first.chatroomId,
    first.taskId
  );
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: deliverable,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId,
  });
}

function subscribeAssignedTaskSnapshotStore(
  wsClient: ConvexClient,
  args: { sessionId: string; machineId: string },
  isStopped: () => boolean
): () => void {
  return wsClient.onUpdate(
    api.machines.listMachineAssignedTaskSnapshots,
    args as never,
    (result) => {
      if (isStopped()) return;
      const tasks = parseAssignedTaskMonitorRows((result as { tasks?: unknown })?.tasks ?? []);
      replaceAssignedTaskSnapshots(tasks);
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Assigned-task snapshot subscription error: ${getErrorMessage(err)}`
      );
    }
  );
}

// fallow-ignore-next-line complexity
export const startTaskMonitorEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void },
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const effectContext = yield* Effect.context<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const runtime = yield* Effect.runtime<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();

    console.log(`[${formatTimestamp()}] 📋 Starting task-monitor (incremental subscribe)`);

    const cooldown = new NudgeCooldown();
    const snapshot = createTaskMonitorSnapshot();
    let stopped = false;
    let monitorPassInFlight = false;

    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      backend: {
        mutation: (fn: unknown, args: Record<string, unknown>) =>
          session.backend.mutation(fn, args),
        query: (fn: unknown, args: Record<string, unknown>) => session.backend.query(fn, args),
      },
    };

    registerNativeDeliverySession({
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      machineId: session.machineId,
    });

    const unsubscribeSnapshotStore = subscribeAssignedTaskSnapshotStore(
      wsClient,
      { sessionId: session.sessionId, machineId: session.machineId },
      () => stopped
    );

    const runMonitorPass = (tasks: AssignedTaskSnapshotView[], pass: TaskMonitorPass): void => {
      if (stopped || monitorPassInFlight || tasks.length === 0) return;
      monitorPassInFlight = true;
      void processTasksUpdate(
        tasks,
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        sessionDeps,
        session.machineId,
        pass
      ).finally(() => {
        monitorPassInFlight = false;
      });
    };

    const reconcileTimer = setInterval(() => {
      runLocalStoreReconcilePass({
        stopped,
        monitorPassInFlight,
        agentMgr,
        runtime,
        effectContext,
        sessionDeps,
        machineId: session.machineId,
      });
    }, NATIVE_DELIVERY_RECONCILE_MS);

    yield* Effect.tryPromise(() =>
      session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
    ).pipe(Effect.catchAll(() => Effect.void));

    const presenceSeedKey = yield* Effect.tryPromise(() => seedPresenceCursor(session)).pipe(
      Effect.orElseSucceed(() => null)
    );

    const signalHandle = yield* runDualChannelFeedLive({
      name: 'assigned-task-signals',
      wsClient,
      def: assignedTaskSignalsFeedDef,
      target: assignedTaskSignalsSubscribeTarget,
      args: {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      buffer: ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
      subscribe: { limit: ASSIGNED_TASK_SIGNAL_FEED_LIMIT },
      snapshot,
      seedCursor: () => seedSignalCursor(session),
      fetchReconcile: () => fetchHydrateRows(session).then((tasks) => ({ tasks })),
      extractReconcileRows: (result) => result.tasks,
      isStopped: () => stopped,
      onSignalRow: (row) =>
        Effect.sync(() => {
          runMonitorPass([row], 'signal');
        }),
      onReconcileRows: (tasks) =>
        Effect.tryPromise(() =>
          processTasksUpdate(
            [...tasks],
            runtime,
            effectContext,
            cooldown,
            agentMgr,
            sessionDeps,
            session.machineId,
            'presence'
          )
        ).pipe(Effect.catchAll(() => Effect.void)),
      onSubscribeError: (err) =>
        console.warn(
          `[${formatTimestamp()}] ⚠️  Task signal subscription error: ${getErrorMessage(err)}`
        ),
    });

    const presenceHandle = yield* runIncrementalSubscribeLive({
      wsClient,
      def: assignedTaskPresenceFeedDef,
      target: assignedTaskPresenceSubscribeTarget,
      args: {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      buffer: ASSIGNED_TASK_PRESENCE_FEED_BUFFER,
      subscribe: { limit: ASSIGNED_TASK_PRESENCE_FEED_LIMIT },
      initialAfterKey: presenceSeedKey,
      onError: (err) =>
        console.warn(
          `[${formatTimestamp()}] ⚠️  Task presence subscription error: ${getErrorMessage(err)}`
        ),
      onItem: ({ item: presence, ack }) =>
        Effect.gen(function* () {
          ack();
          if (stopped) return;
          const row = snapshot.mergePresence(presence);
          if (!row) return;
          yield* Effect.sync(() => {
            runMonitorPass([row], 'presence');
          });
        }),
    });

    return {
      stop() {
        stopped = true;
        unsubscribeSnapshotStore();
        clearAssignedTaskSnapshots();
        unregisterNativeDeliverySession();
        clearInterval(reconcileTimer);
        void Effect.runPromise(signalHandle.stop());
        void Effect.runPromise(presenceHandle.stop());
        console.log(`[${formatTimestamp()}] 📋 Task-monitor stopped`);
      },
    };
  });
