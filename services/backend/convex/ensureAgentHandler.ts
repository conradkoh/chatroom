/**
 * Ensure Agent Handler
 *
 * A scheduled internalMutation that fires ~120 seconds after a task enters a
 * pending/acknowledged/in_progress state.  It checks whether the task has been
 * updated since the snapshot was taken.  If it has not been updated (i.e. no
 * agent has picked it up), it dispatches a `start-agent` command to every
 * remote-configured machine for the chatroom so that a crashed or missing
 * agent is automatically restarted.
 *
 * SMART TOKEN CHECK (in_progress tasks)
 * ──────────────────────────────────────
 * For tasks already in_progress, the handler first checks whether the assigned
 * role's participant has produced a token recently (within STUCK_TOKEN_THRESHOLD_MS).
 * If the agent is still actively outputting tokens, it is considered healthy and
 * the check is rescheduled for another 120s instead of triggering a restart.
 * Only when token output goes stale does the handler proceed with a restart.
 *
 * DESIGN NOTES
 * ─────────────
 * • Idempotency — the `snapshotUpdatedAt` guard prevents double-firing: if
 *   any mutation has touched the task between scheduling and execution, the
 *   handler exits silently.
 * • No session auth — this is an internal system mutation; it is never
 *   exposed as a public API surface.
 * • Callers are responsible for scheduling via `ctx.scheduler.runAfter` after
 *   creating or transitioning a task.
 */

import { v } from 'convex/values';

import { STUCK_TOKEN_THRESHOLD_MS } from '../config/reliability';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Delay (ms) between task creation/transition and the ensure-agent check.
 * Used for pending, acknowledged, and in_progress tasks.
 * For in_progress tasks, the check is rescheduled if the agent is still
 * producing tokens (see smart token check above).
 */
export const ENSURE_AGENT_DELAY_MS = 120_000;

/** Task statuses that indicate an agent should be running. */
const ACTIVE_TASK_STATUSES = new Set(['pending', 'acknowledged', 'in_progress']);

// ─── Internal Mutation ───────────────────────────────────────────────────────

/**
 * Scheduled check: if the task is still in an active status and has not been
 * updated since the snapshot, dispatch `start-agent` commands to all remote
 * agents configured for this chatroom.
 *
 * For in_progress tasks, the agent's token activity is checked first.
 * If the agent is still producing output, the check is rescheduled instead
 * of triggering a restart.
 */
export const check = internalMutation({
  args: {
    /** The task to check. */
    taskId: v.id('chatroom_tasks'),
    /** The chatroom the task belongs to. */
    chatroomId: v.id('chatroom_rooms'),
    /**
     * The `updatedAt` timestamp of the task at the time the handler was
     * scheduled.  If the task has been updated since then, the check is
     * skipped — an agent has already picked it up.
     */
    snapshotUpdatedAt: v.number(),
  },

  handler: async (ctx, args) => {
    const { taskId, chatroomId, snapshotUpdatedAt } = args;

    // ── 1. Fetch the task ─────────────────────────────────────────────────

    const task = await ctx.db.get('chatroom_tasks', taskId);

    if (!task) {
      // Task deleted — nothing to do.
      return;
    }

    // ── 2. Guard: task must still be in an active status ─────────────────

    if (!ACTIVE_TASK_STATUSES.has(task.status)) {
      // Task has moved to a terminal/non-active status (completed, queued, etc.)
      return;
    }

    // ── 3. Guard: skip if the task has been updated since the snapshot ────

    if (task.updatedAt > snapshotUpdatedAt) {
      // An agent has already touched the task — no intervention needed.
      return;
    }

    // ── 4. Smart token check for in_progress tasks ────────────────────────
    //
    // If the task is already in_progress, the agent may still be actively
    // working (just taking a long time). Check whether the assigned role's
    // participant is producing tokens before deciding to restart.
    //
    // If tokens are fresh (within STUCK_TOKEN_THRESHOLD_MS), reschedule
    // another check instead of restarting — the agent is still alive.

    if (task.status === 'in_progress' && task.assignedTo) {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', task.assignedTo!)
        )
        .first();

      if (participant?.lastSeenTokenAt != null) {
        const now = Date.now();
        const tokenAge = now - participant.lastSeenTokenAt;

        if (tokenAge < STUCK_TOKEN_THRESHOLD_MS) {
          // Agent is still producing tokens — healthy. Reschedule another
          // check in ENSURE_AGENT_DELAY_MS to keep monitoring.
          await ctx.scheduler.runAfter(ENSURE_AGENT_DELAY_MS, internal.ensureAgentHandler.check, {
            taskId,
            chatroomId,
            snapshotUpdatedAt: task.updatedAt,
          });
          return;
        }
        // Token output is stale — fall through to restart.
      }
      // No participant record or no token activity recorded — fall through to restart.
    }

    // ── 5. Find all remote agent configs for this chatroom ────────────────

    const teamAgentConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();

    const remoteConfigs = teamAgentConfigs.filter((c) => c.type === 'remote');

    if (remoteConfigs.length === 0) {
      // No remote agents configured — nothing to restart.
      return;
    }

    // ── 6. Dispatch start-agent commands for each remote config ───────────

    const now = Date.now();

    for (const config of remoteConfigs) {
      if (!config.machineId) {
        // Remote config is missing a machineId — skip.
        continue;
      }

      if (config.desiredState !== 'running') {
        // Only restart agents that are explicitly desired to be running.
        // Absent desiredState (undefined) and 'stopped' both skip restart.
        continue;
      }

      // Resolve the machine document to get the owner (sentBy).
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
        .first();

      if (!machine) {
        // Machine no longer registered — skip this config.
        continue;
      }

      await ctx.db.insert('chatroom_machineCommands', {
        machineId: config.machineId,
        type: 'start-agent',
        payload: {
          chatroomId,
          role: config.role,
          agentHarness: config.agentHarness,
          model: config.model,
          workingDir: config.workingDir,
        },
        reason: 'ensure-agent-retry',
        status: 'pending',
        sentBy: machine.userId,
        createdAt: now,
      });
    }
  },
});
