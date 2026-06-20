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
import { listTasksReadyForNudge, NudgeCooldown } from './task-monitor-logic.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type AssignedTasksResult = FunctionReturnType<typeof api.machines.getAssignedTasks>;

function runNativeInjectionFork(
  task: AssignedTaskView,
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>,
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>,
  dedup: NativeInjectionDedup,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: {
    sessionId: string;
    convexUrl: string;
    backend: {
      mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
      query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    };
  }
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

// fallow-ignore-next-line complexity
function runNudgeEffect(
  task: AssignedTaskView,
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>,
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  dedup: NativeInjectionDedup,
  session: {
    sessionId: string;
    convexUrl: string;
    backend: {
      mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
      query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    };
  }
): void {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;

  if (isNativeHarness(agentConfig.agentHarness)) {
    console.log(
      `[TaskMonitor] native nudge ${role}@${chatroomId} — retrying injection for pending task ${task.taskId}`
    );
    dedup.clear(task.taskId);
    runNativeInjectionFork(task, runtime, effectContext, dedup, agentMgr, session);
    return;
  }

  const workingDir = agentConfig.workingDir;
  if (!workingDir) return;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';

  const compressMode = parseCompressContext(task.taskContent ?? '');
  const wantResume = compressContextToWantResume(compressMode);

  console.log(
    `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}, compress_context=${compressMode}, wantResume=${wantResume}`
  );

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

    const sessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      backend: {
        mutation: (fn: unknown, args: Record<string, unknown>) =>
          session.backend.mutation(fn, args),
        query: (fn: unknown, args: Record<string, unknown>) => session.backend.query(fn, args),
      },
    };

    // fallow-ignore-next-line complexity
    const onTasksUpdate = (result: AssignedTasksResult | undefined): void => {
      if (stopped || !result?.tasks?.length) return;

      for (const task of result.tasks) {
        if (shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })) {
          runNativeInjectionFork(task, runtime, effectContext, dedup, agentMgr, sessionDeps);
        }
      }

      const tasksToNudge = listTasksReadyForNudge(result.tasks, Date.now(), cooldown);
      for (const task of tasksToNudge) {
        runNudgeEffect(task, runtime, effectContext, agentMgr, dedup, sessionDeps);
      }
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
