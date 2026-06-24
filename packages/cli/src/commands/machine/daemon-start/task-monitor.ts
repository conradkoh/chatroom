/**
 * Task Monitor — reactive subscription to assigned tasks for this machine.
 *
 * Restarts alive agents that have pending tasks but are not actively listening
 * in the get-next-task loop (stale waiting or idle after delivery).
 *
 * For native harnesses, injects tasks via resumeTurn instead of cold-restart nudge.
 */

import {
  compressContextToWantResume,
  parseCompressContext,
} from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Runtime, type Context } from 'effect';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import {
  isNativeHarness,
  NativeInjectionDedup,
  shouldInjectNativeTask,
} from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import {
  listTasksReadyForNudge,
  listNativeTasksNeedingRevive,
  NudgeCooldown,
} from './task-monitor-logic.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type AssignedTasksResult = FunctionReturnType<typeof api.machines.getAssignedTasks>;

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

interface SessionDeps {
  sessionId: string;
  convexUrl: string;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

function resolveTaskWantResume(task: AssignedTaskView): boolean {
  return compressContextToWantResume(parseCompressContext(task.taskContent ?? ''));
}

function runNativeInjectionFork(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  dedup: NativeInjectionDedup,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: SessionDeps
): void {
  Runtime.runFork(runtime)(
    runNativeInjectionEffect(
      task,
      {
        sessionId: session.sessionId,
        backend: session.backend,
        agentMgr: {
          resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
        },
        convexUrl: session.convexUrl,
      },
      dedup
    ).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] native injection failed for ${task.agentConfig.role}@${task.chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

function runNativeNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  dedup: NativeInjectionDedup,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: SessionDeps
): void {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  console.log(
    `[TaskMonitor] native nudge ${role}@${chatroomId} — retrying injection for pending task ${task.taskId}`
  );
  dedup.clear(task.taskId);
  runNativeInjectionFork(task, runtime, effectContext, dedup, agentMgr, session);
}

function buildCliNudgeLogLine(task: AssignedTaskView): string {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';
  const compressMode = parseCompressContext(task.taskContent ?? '');
  const wantResume = resolveTaskWantResume(task);
  return `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}, compress_context=${compressMode}, wantResume=${wantResume}`;
}

function executeCliNudge(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const workingDir = agentConfig.workingDir;
  if (!workingDir) return;

  const wantResume = resolveTaskWantResume(task);

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
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const workingDir = agentConfig.workingDir;
  if (!workingDir) return;

  const wantResume = resolveTaskWantResume(task);

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

function runCliNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  console.log(buildCliNudgeLogLine(task));
  executeCliNudge(task, runtime, effectContext, agentMgr);
}

function runNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  dedup: NativeInjectionDedup,
  session: SessionDeps
): void {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    runNativeNudgeEffect(task, runtime, effectContext, dedup, agentMgr, session);
    return;
  }
  runCliNudgeEffect(task, runtime, effectContext, agentMgr);
}

// fallow-ignore-next-line complexity
function processTasksUpdate(
  tasks: AssignedTaskView[],
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  dedup: NativeInjectionDedup,
  cooldown: NudgeCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: SessionDeps
): void {
  const now = Date.now();
  const localHealth = {
    getSlot: (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role),
    isPidAlive: (pid: number) => isProcessAlive((p) => process.kill(p, 0), pid),
  };

  for (const task of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    runNativeReviveEffect(task, runtime, effectContext, agentMgr);
  }

  for (const task of tasks) {
    if (shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })) {
      runNativeInjectionFork(task, runtime, effectContext, dedup, agentMgr, sessionDeps);
    }
  }

  const tasksToNudge = listTasksReadyForNudge(tasks, now, cooldown);
  for (const task of tasksToNudge) {
    runNudgeEffect(task, runtime, effectContext, agentMgr, dedup, sessionDeps);
  }
}

export const startTaskMonitorSubscriptionEffect = (
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

    console.log(`[${formatTimestamp()}] 📋 Starting task-monitor subscription (reactive)`);

    const cooldown = new NudgeCooldown();
    const dedup = new NativeInjectionDedup();
    let stopped = false;

    const sessionDeps: SessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      backend: {
        mutation: (fn: unknown, args: Record<string, unknown>) =>
          session.backend.mutation(fn, args),
        query: (fn: unknown, args: Record<string, unknown>) => session.backend.query(fn, args),
      },
    };

    const onTasksUpdate = (result: AssignedTasksResult | undefined): void => {
      if (stopped || !result?.tasks?.length) return;
      processTasksUpdate(
        result.tasks,
        runtime,
        effectContext,
        dedup,
        cooldown,
        agentMgr,
        sessionDeps
      );
    };

    const unsubscribe = wsClient.onUpdate(
      api.machines.getAssignedTasks,
      { sessionId: session.sessionId, machineId: session.machineId },
      onTasksUpdate,
      (err) =>
        console.warn(
          `[${formatTimestamp()}] Task-monitor subscription error: ${getErrorMessage(err)}`
        )
    );

    return {
      stop() {
        stopped = true;
        unsubscribe();
        console.log(`[${formatTimestamp()}] 📋 Task-monitor subscription stopped`);
      },
    };
  });
