/**
 * Task Monitor — indexed snapshot projection + WS signal/presence subscribe.
 *
 * - Hydrate: one-shot listMachineAssignedTaskSnapshots (slim rows, no task.content)
 * - Signal feed: revisionKey cursor — revive/inject
 * - Presence feed: presenceUpdatedAt cursor — nudge timing (replaces 15s reconcile poll)
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 */

import { roleSupportsSessionAugmentation } from '@workspace/backend/src/domain/entities/team-agent-settings.js';
import {
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSnapshotView,
  AssignedTaskView,
  ListMachineAssignedTaskSnapshotsResult,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import type { ConvexClient } from 'convex/browser';
import { Effect, Runtime, type Context } from 'effect';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import {
  listTasksReadyForNudge,
  listNativeTasksNeedingRevive,
  NudgeCooldown,
} from './task-monitor-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import { runIncrementalSubscribeLive } from '../../../infrastructure/incremental-sync/feed-runtime.js';
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
    afterPresenceAt: 0,
    limit: ASSIGNED_TASK_PRESENCE_FEED_LIMIT,
  })) as { highPresenceAt: number | null } | null;
  return seedPage?.highPresenceAt != null ? String(seedPage.highPresenceAt) : null;
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
  for (const row of listTasksReadyForNudge(tasks, now, cooldown)) {
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
  pass: TaskMonitorPass
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
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId,
  });
  if (pass === 'presence') {
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

    yield* Effect.tryPromise(() =>
      session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
    ).pipe(Effect.catchAll(() => Effect.void));

    const hydrate = yield* Effect.tryPromise(
      () =>
        session.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        }) as Promise<ListMachineAssignedTaskSnapshotsResult>
    ).pipe(Effect.orElseSucceed(() => ({ tasks: [] })));
    snapshot.replaceAll(hydrate.tasks ?? []);

    const signalSeedKey = yield* Effect.tryPromise(() => seedSignalCursor(session)).pipe(
      Effect.orElseSucceed(() => null)
    );
    const presenceSeedKey = yield* Effect.tryPromise(() => seedPresenceCursor(session)).pipe(
      Effect.orElseSucceed(() => null)
    );

    const signalHandle = yield* runIncrementalSubscribeLive({
      wsClient,
      def: assignedTaskSignalsFeedDef,
      target: assignedTaskSignalsSubscribeTarget,
      args: {
        sessionId: session.sessionId,
        machineId: session.machineId,
      },
      buffer: ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
      subscribe: { limit: ASSIGNED_TASK_SIGNAL_FEED_LIMIT },
      initialAfterKey: signalSeedKey,
      onError: (err) =>
        console.warn(
          `[${formatTimestamp()}] ⚠️  Task signal subscription error: ${getErrorMessage(err)}`
        ),
      onItem: ({ item: signal, ack }) =>
        Effect.gen(function* () {
          ack();
          if (stopped) return;
          const row = snapshot.mergeSignal(signal);
          if (!row) return;
          yield* Effect.sync(() => {
            runMonitorPass([row], 'signal');
          });
        }),
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
          const row = snapshot.mergePresence(presence as AssignedTaskPresenceSignal);
          if (!row) return;
          yield* Effect.sync(() => {
            runMonitorPass([row], 'presence');
          });
        }),
    });

    return {
      stop() {
        stopped = true;
        void Effect.runPromise(signalHandle.stop());
        void Effect.runPromise(presenceHandle.stop());
        console.log(`[${formatTimestamp()}] 📋 Task-monitor stopped`);
      },
    };
  });
