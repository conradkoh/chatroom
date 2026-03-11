/** Scheduled fallback that restarts a stale or stuck agent for an active task. */

import { v } from 'convex/values';

import {
  STUCK_TOKEN_THRESHOLD_MS,
  ENSURE_AGENT_FALLBACK_DELAY_MS,
} from '../config/reliability';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { getTeamEntryPoint } from '../src/domain/entities/team';
import { emitRequestStartIfNeeded } from '../src/domain/usecase/agent/emit-request-start';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Task statuses that indicate an agent should be running. */
const ACTIVE_TASK_STATUSES = new Set(['pending', 'acknowledged', 'in_progress']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the assigned agent has stale or missing token output. */
async function isAgentStuck(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string
): Promise<boolean> {
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', assignedTo)
    )
    .first();

  if (participant?.lastSeenTokenAt == null) {
    // No participant or no token activity — assume stuck
    return true;
  }

  const tokenAge = Date.now() - participant.lastSeenTokenAt;
  if (tokenAge < STUCK_TOKEN_THRESHOLD_MS) {
    // Agent is still producing tokens — healthy
    return false;
  }

  // Token output is stale — agent is stuck
  return true;
}

// ─── Internal Mutation ───────────────────────────────────────────────────────

/** Checks whether an active task is stale and restarts the responsible agent if needed. */
export const check = internalMutation({
  args: {
    taskId: v.id('chatroom_tasks'),
    chatroomId: v.id('chatroom_rooms'),
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
      // Task has moved to a terminal/non-active status (completed, etc.)
      return;
    }

    // ── 3. Guard: skip if the task has been updated since the snapshot ────

    if (task.updatedAt > snapshotUpdatedAt) {
      // An agent has already touched the task — no intervention needed.
      return;
    }

    // ── 4. Smart token check for in_progress tasks ────────────────────────
    //
    // If the task is already in_progress, check whether the agent is still
    // actively producing tokens. If healthy, reschedule and return without
    // restarting. Only stuck agents (stale token output) are restarted.

    if (task.status === 'in_progress' && task.assignedTo) {
      const stuck = await isAgentStuck(ctx, chatroomId, task.assignedTo);
      if (!stuck) {
        // Agent is still producing tokens — reschedule check and wait.
        await ctx.scheduler.runAfter(ENSURE_AGENT_FALLBACK_DELAY_MS, internal.ensureAgentHandler.check, {
          taskId,
          chatroomId,
          snapshotUpdatedAt: task.updatedAt,
        });
        return;
      }
      // Agent is stuck (stale or missing token output) — fall through to restart.
    }

    // ── 5. Determine which role(s) to restart ────────────────────────────
    //
    // Only restart the agent responsible for this task.

    let rolesToRestart: string[];

    if (task.assignedTo) {
      rolesToRestart = [task.assignedTo.toLowerCase()];
    } else {
      const chatroom = await ctx.db.get(chatroomId);
      const entryPoint = getTeamEntryPoint(chatroom ?? {});
      if (entryPoint) {
        rolesToRestart = [entryPoint.toLowerCase()];
      } else {
        const teamAgentConfigs = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        rolesToRestart = teamAgentConfigs
          .filter((c) => c.type === 'remote')
          .map((c) => c.role.toLowerCase());
      }
    }

    if (rolesToRestart.length === 0) return;

    // ── 6. Emit requestStart for each role via shared helper ─────────────

    for (const role of rolesToRestart) {
      await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role,
        reason: 'platform.ensure_agent',
        skipCircuitBreaker: false,
        createFromPreferences: false,
      });
    }
  },
});
