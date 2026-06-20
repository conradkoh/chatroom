/**
 * Task Monitor — reactive subscription to assigned tasks for this machine.
 *
 * Restarts alive agents that have pending tasks but are not actively listening
 * in the get-next-task loop (stale waiting or idle after delivery).
 */

import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Runtime, type Context } from 'effect';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import { listTasksReadyForNudge, NudgeCooldown } from './task-monitor-logic.js';
import type { AgentHarness } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type AssignedTasksResult = FunctionReturnType<typeof api.machines.getAssignedTasks>;

function runNudgeEffect(
  task: AssignedTaskView,
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>,
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const workingDir = agentConfig.workingDir;
  if (!workingDir) return;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';

  console.log(
    `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}`
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
        wantResume: true,
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
    let stopped = false;

    // fallow-ignore-next-line complexity
    const onTasksUpdate = (result: AssignedTasksResult | undefined): void => {
      if (stopped || !result?.tasks?.length) return;
      const tasksToNudge = listTasksReadyForNudge(result.tasks, Date.now(), cooldown);
      for (const task of tasksToNudge) {
        runNudgeEffect(task, runtime, effectContext, agentMgr);
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
