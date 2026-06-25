/**
 * Task Monitor — reactive subscription to assigned tasks for this machine.
 *
 * Restarts alive CLI agents that have pending tasks but are not actively listening
 * in the get-next-task loop (stale waiting or idle after delivery).
 *
 * For native harnesses, injects tasks via resumeTurn on assignment updates.
 * Native revive cold-starts when backend PID is stale locally; injection retries
 * are not nudged (delivery ledger + reactive inject only).
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
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
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

function resolveTaskRunnerContext(task: AssignedTaskView):
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
  const ctx = resolveTaskRunnerContext(task);
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
  const ctx = resolveTaskRunnerContext(task);
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

function runCliNudgeEffect(
  task: AssignedTaskView,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  console.log(buildCliNudgeLogLine(task));
  executeCliNudge(task, runtime, effectContext, agentMgr);
}

function nudgeStuckTasks(
  tasks: AssignedTaskView[],
  now: number,
  cooldown: NudgeCooldown,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  for (const task of listTasksReadyForNudge(tasks, now, cooldown)) {
    runCliNudgeEffect(task, runtime, effectContext, agentMgr);
  }
}

function reviveNativeTasks(
  tasks: AssignedTaskView[],
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
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  for (const task of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    runNativeReviveEffect(task, runtime, effectContext, agentMgr);
  }
}

function processTasksUpdate(
  tasks: AssignedTaskView[],
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  cooldown: NudgeCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps
): void {
  const now = Date.now();
  const localHealth = {
    getSlot: (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role),
    isPidAlive: (pid: number) => isProcessAlive((p) => process.kill(p, 0), pid),
  };

  reviveNativeTasks(tasks, localHealth, now, cooldown, runtime, effectContext, agentMgr);
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
  });
  nudgeStuckTasks(tasks, now, cooldown, runtime, effectContext, agentMgr);
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
    let stopped = false;

    const sessionDeps: NativeTaskDeliverySessionDeps = {
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
      processTasksUpdate(result.tasks, runtime, effectContext, cooldown, agentMgr, sessionDeps);
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
