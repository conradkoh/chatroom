/** Scheduled fallback that restarts a stale or stuck agent for an active task. */

import { v } from 'convex/values';

import {
  STUCK_TOKEN_THRESHOLD_MS,
  ENSURE_AGENT_FALLBACK_DELAY_MS,
  CIRCUIT_BREAKER_MAX_EXITS,
  CIRCUIT_WINDOW_MS,
  CIRCUIT_COOLDOWN_MS,
} from '../config/reliability';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { getTeamEntryPoint } from '../src/domain/entities/team';

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

type CircuitStatus = 'closed' | 'open';

/**
 * Check the circuit breaker for a given agent config.
 * Returns 'closed' (allow restart) or 'open' (block restart).
 *
 * State transitions:
 * - CLOSED → OPEN when exits ≥ MAX_EXITS in WINDOW
 * - OPEN → HALF-OPEN when cool-down elapsed
 * - HALF-OPEN → CLOSED when agent calls get-next-task (handled in participants.join)
 */
async function checkCircuitBreaker(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  config: {
    _id: Id<'chatroom_teamAgentConfigs'>;
    role: string;
    machineId?: string;
    circuitState?: string;
    circuitOpenedAt?: number;
  }
): Promise<CircuitStatus> {
  const now = Date.now();
  const { circuitState, circuitOpenedAt } = config;

  // 1. OPEN → check cool-down
  if (circuitState === 'open') {
    if (circuitOpenedAt && now - circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
      await ctx.db.patch(config._id, { circuitState: 'half-open' });
      return 'closed';
    }
    return 'open';
  }

  // 2. HALF-OPEN → allow one attempt
  if (circuitState === 'half-open') {
    return 'closed';
  }

  // 3. CLOSED (or undefined) → count recent exits
  const windowStart = now - CIRCUIT_WINDOW_MS;
  const recentEvents = await ctx.db
    .query('chatroom_eventStream')
    .withIndex('by_chatroomId_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', config.role)
    )
    .order('desc')
    .take(CIRCUIT_BREAKER_MAX_EXITS + 5);

  const recentExits = recentEvents.filter(
    (e) =>
      e.type === 'agent.exited' &&
      e.timestamp >= windowStart &&
      e.stopReason !== 'intentional_stop'
  );

  if (recentExits.length >= CIRCUIT_BREAKER_MAX_EXITS) {
    await ctx.db.patch(config._id, { circuitState: 'open', circuitOpenedAt: now });
    if (config.machineId) {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.circuitOpen',
        chatroomId,
        role: config.role,
        machineId: config.machineId,
        reason: `${CIRCUIT_BREAKER_MAX_EXITS} exits in ${CIRCUIT_WINDOW_MS / 60_000} minutes`,
        timestamp: now,
      });
    }
    return 'open';
  }

  return 'closed';
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

    // ── 5a. Determine which role(s) to restart ────────────────────────────
    //
    // Only restart the agent that is responsible for this task.
    // - If the task is assigned to a specific role → restart only that role.
    // - If the task has no assignee (should not happen after fix in messages.ts,
    //   but handled defensively) → restart only the entry point.
    //
    // This prevents "restart all agents" when only the entry point needs to
    // wake up to claim a user message.

    let rolesToRestart: Set<string>;

    if (task.assignedTo) {
      rolesToRestart = new Set([task.assignedTo.toLowerCase()]);
    } else {
      // Defensive fallback: fetch the chatroom to get the entry point.
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      const entryPoint = getTeamEntryPoint(chatroom ?? {});
      if (entryPoint) {
        rolesToRestart = new Set([entryPoint.toLowerCase()]);
      } else {
        // No entry point configured — fall back to restarting all configured agents.
        rolesToRestart = new Set(remoteConfigs.map((c) => c.role.toLowerCase()));
      }
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

      // Circuit breaker — prevent infinite restart loops
      const circuitStatus = await checkCircuitBreaker(ctx, chatroomId, config);
      if (circuitStatus === 'open') {
        continue; // skip restart for this agent
      }

      if (!rolesToRestart.has(config.role.toLowerCase())) {
        // This agent is not responsible for the current task — skip.
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

      // Emit agent.requestStart to the event stream — daemon reads this to start the agent.
      // Only emit if the remote config has all required fields for a start request.
      if (config.agentHarness && config.model && config.workingDir) {
        await ctx.db.insert('chatroom_eventStream', {
          type: 'agent.requestStart',
          chatroomId,
          machineId: config.machineId!,
          role: config.role,
          agentHarness: config.agentHarness,
          model: config.model,
          workingDir: config.workingDir,
          reason: 'ensure-agent-retry',
          deadline: now + ENSURE_AGENT_FALLBACK_DELAY_MS * 2,
          timestamp: now,
        });
      }
    }
  },
});
