/**
 * Task Monitor — incremental subscribe + reconcile for assigned tasks on this machine.
 *
 * - Signal feed: patch working snapshot, run revive/inject for that row (no lite list refetch)
 * - Reconcile poll: refresh snapshot from listAssignedTasksLite, full pass including nudge
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 */

import {
  compressContextToWantResume,
  parseCompressContext,
} from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type {
  AssignedTaskLiteView,
  AssignedTaskSignal,
  AssignedTaskView,
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
import { TaskMonitorSnapshot } from './task-monitor-snapshot.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import {
  runIncrementalSubscribeLive,
  runReconcilePollLive,
} from '../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  ASSIGNED_TASK_RECONCILE_INTERVAL_MS,
  ASSIGNED_TASK_SIGNAL_FEED_BUFFER,
  ASSIGNED_TASK_SIGNAL_FEED_LIMIT,
  assignedTaskSignalsFeedDef,
  assignedTaskSignalsSubscribeTarget,
} from '../../../infrastructure/incremental-sync/feeds/assigned-task-signals.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

type ListAssignedTasksLiteResult = { tasks: AssignedTaskLiteView[] };

type TaskMonitorPass = 'signal' | 'reconcile';

function resolveTaskWantResume(task: AssignedTaskView): boolean {
  return compressContextToWantResume(parseCompressContext(task.taskContent ?? ''));
}

function buildCliNudgeLogLine(task: AssignedTaskView): string {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';
  const compressMode = parseCompressContext(task.taskContent ?? '');
  const wantResume = resolveTaskWantResume(task);
  return `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}, compress_context=${compressMode}, wantResume=${wantResume}`;
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
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;

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
  lite: AssignedTaskLiteView
): Promise<AssignedTaskView | null> {
  const result = (await sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
    sessionId: sessionDeps.sessionId,
    machineId,
    taskId: lite.taskId,
    role: lite.agentConfig.role,
  })) as AssignedTaskView | null;
  return result;
}

function runCliNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  console.log(buildCliNudgeLogLine(task));
  executeCliNudge(task, runtime, effectContext, agentMgr);
}

async function nudgeStuckTasks(
  tasks: AssignedTaskLiteView[],
  now: number,
  cooldown: NudgeCooldown,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const lite of listTasksReadyForNudge(tasks, now, cooldown)) {
    const full = await fetchTaskForAction(sessionDeps, machineId, lite);
    if (!full) continue;
    runCliNudgeEffect(full, runtime, effectContext, agentMgr);
  }
}

async function reviveNativeTasks(
  tasks: AssignedTaskLiteView[],
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
  for (const lite of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    const full = await fetchTaskForAction(sessionDeps, machineId, lite);
    if (!full) continue;
    runNativeReviveEffect(full, runtime, effectContext, agentMgr);
  }
}

async function processTasksUpdate(
  tasks: AssignedTaskLiteView[],
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
  if (pass === 'reconcile') {
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
    const snapshot = new TaskMonitorSnapshot();
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

    const runMonitorPass = (tasks: AssignedTaskLiteView[], pass: TaskMonitorPass): void => {
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

    const queryLiteTasks = (): Promise<ListAssignedTasksLiteResult> =>
      session.backend.query(api.machines.listAssignedTasksLite, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      }) as Promise<ListAssignedTasksLiteResult>;

    const hydrateSnapshotFromBackend = async (): Promise<void> => {
      const result = await queryLiteTasks();
      snapshot.replaceAll(result?.tasks ?? []);
    };

    const resolveLiteForSignal = async (
      signal: AssignedTaskSignal
    ): Promise<AssignedTaskLiteView | undefined> => {
      const merged = snapshot.mergeSignal(signal);
      if (merged) {
        return merged;
      }
      await hydrateSnapshotFromBackend();
      return snapshot.mergeSignal(signal) ?? snapshot.get(signal.taskId, signal.role);
    };

    const seedPage = (yield* Effect.tryPromise(() =>
      session.backend.query(api.machines.subscribeAssignedTaskSignalsSince, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        limit: ASSIGNED_TASK_SIGNAL_FEED_LIMIT,
      })
    ).pipe(Effect.orElseSucceed(() => null))) as {
      highKey: string | null;
    } | null;

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
      initialAfterKey: seedPage?.highKey ?? null,
      onError: (err) =>
        console.warn(
          `[${formatTimestamp()}] ⚠️  Task signal subscription error: ${getErrorMessage(err)}`
        ),
      onItem: ({ item: signal, ack }) =>
        Effect.gen(function* () {
          ack();
          if (stopped) return;
          const lite = yield* Effect.tryPromise(() => resolveLiteForSignal(signal));
          if (!lite) return;
          runMonitorPass([lite], 'signal');
        }),
    });

    const reconcileHandle = yield* runReconcilePollLive({
      name: 'assigned-tasks-reconcile',
      poll: () => queryLiteTasks(),
      args: undefined,
      intervalMs: ASSIGNED_TASK_RECONCILE_INTERVAL_MS,
      onResult: (result) =>
        Effect.sync(() => {
          const tasks = result?.tasks ?? [];
          snapshot.replaceAll(tasks);
          runMonitorPass(tasks, 'reconcile');
        }),
    });

    const initial = yield* Effect.tryPromise(() => queryLiteTasks()).pipe(
      Effect.orElseSucceed(() => null)
    );
    if (initial?.tasks) {
      snapshot.replaceAll(initial.tasks);
      runMonitorPass(initial.tasks, 'reconcile');
    }

    return {
      stop() {
        stopped = true;
        void Effect.runPromise(signalHandle.stop());
        void Effect.runPromise(reconcileHandle.stop());
        console.log(`[${formatTimestamp()}] 📋 Task-monitor stopped`);
      },
    };
  });
