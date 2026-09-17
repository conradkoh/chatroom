import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import { formatTimestamp } from '../../daemon/entry/daemon-utils.js';
import { shutdownAllCommandsEffect } from '../../daemon/entry/handlers/command-runner.js';
import type { TaskService } from '../../daemon/services/task-service/index.js';

export const onDaemonShutdownEffect: Effect.Effect<
  void,
  never,
  DaemonAgentProcessManagerCommandService | DaemonSessionService
> = Effect.gen(function* () {
  const agentPm = yield* DaemonAgentProcessManagerCommandService;
  const session = yield* DaemonSessionService;

  // Kill all running command processes before stopping agents
  yield* shutdownAllCommandsEffect;

  // Wait for any in-progress agent turn to end gracefully
  yield* Effect.race(
    Effect.promise(() => agentPm.whenTurnEndsIdle()),
    Effect.sleep(SCOPE_TARGET_STOP_TIMEOUT_MS).pipe(
      Effect.tap(() => Effect.sync(() => console.log('[shutdown] idle wait timed out, proceeding')))
    )
  );

  const activeAgents = agentPm.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s) locally...`);

    // Release in-flight tasks the daemon tracks for active roles back to
    // `pending` before stopping them. The backend no longer infers task
    // releases from `agent.exited` facts (plan R1/R2) — shutdown recovery is
    // daemon-owned via the scoped, per-task release path. The scoped mutation
    // no-ops on tasks that are not acknowledged/in_progress.
    yield* Effect.promise(async () => {
      const tasksReleased = await releaseInFlightTasksForAgents(session.taskService, activeAgents);
      if (tasksReleased > 0) {
        console.log(
          `[${formatTimestamp()}] Released ${tasksReleased} in-flight task(s) to pending`
        );
      }
    });

    let totalStopped = 0;
    let totalFailed = 0;
    yield* Effect.all(
      activeAgents.map(({ chatroomId, role }) =>
        Effect.promise(() =>
          agentPm.stopAgent({ chatroomId, role, reason: 'daemon.shutdown' })
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              totalStopped += 1;
            })
          ),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              totalFailed += 1;
              console.log(`   ⚠️  Failed to stop ${role}@${chatroomId}: ${(e as Error).message}`);
            })
          )
        )
      ),
      { concurrency: 'unbounded' }
    );

    if (totalFailed > 0) {
      console.log(
        `[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped, ${totalFailed} failed`
      );
    } else if (totalStopped > 0) {
      console.log(`[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped`);
    }
  }

  // Mark daemon offline (best-effort)
  yield* Effect.promise(() =>
    session.backend
      .mutation(api.machines.markDaemonOffline, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
      .catch(() => {})
  );
});

/**
 * Releases in-flight tasks the daemon tracks for active roles back to
 * `pending`, one role at a time. A role whose release path fails is logged and
 * skipped so shutdown never stalls on a single failing role.
 */
async function releaseInFlightTasksForAgents(
  taskService: TaskService,
  activeAgents: readonly { chatroomId: string; role: string }[]
): Promise<number> {
  let tasksReleased = 0;
  for (const { chatroomId, role } of activeAgents) {
    try {
      tasksReleased += await releaseRoleInFlightTasks(taskService, chatroomId, role);
    } catch (e) {
      console.log(
        `   ⚠️  Failed to release in-flight tasks for ${role}@${chatroomId}: ${(e as Error).message}`
      );
    }
  }
  return tasksReleased;
}

async function releaseRoleInFlightTasks(
  taskService: TaskService,
  chatroomId: string,
  role: string
): Promise<number> {
  let released = 0;
  for (const task of taskService.listTasksForRole(chatroomId, role)) {
    if (task.status !== 'acknowledged' && task.status !== 'in_progress') continue;
    await taskService.releaseTaskAfterTurnFailure({
      chatroomId,
      role,
      taskId: task.taskId,
    });
    released += 1;
  }
  return released;
}
