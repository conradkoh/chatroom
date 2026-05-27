/**
 * Use Case: Stop Agent
 *
 * Encapsulates the logic for stopping an agent on a machine:
 *   1. Dispatches a stop-agent command to the machine daemon
 *
 * This is the counterpart to start-agent.ts and provides a clean
 * domain-level interface for stopping agents.
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import { transitionAgentStatus } from './transition-agent-status';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentStopReason } from '../../entities/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for stopping an agent. */
export interface StopAgentInput {
  /** The machine running the agent. */
  machineId: string;
  /** The chatroom containing the agent. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the agent (e.g. "builder", "reviewer"). */
  role: string;
  /** The user dispatching the stop (must own the machine). */
  userId: Id<'users'>;
  /**
   * Human-readable reason for this stop command.
   * Stored in the command record and logged by the daemon to aid tracing.
   * Examples: 'user.stop', 'platform.dedup'
   */
  reason: AgentStopReason;
}

/** Result of a stop-agent operation. */
export interface StopAgentResult {
  // No command record — stop requests go via the event stream
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Stop an agent by dispatching a stop-agent command to the machine daemon.
 *
 * @param ctx - Convex mutation context (provides db access)
 * @param input - The stop parameters
 * @returns The command ID
 */
export async function stopAgent(ctx: MutationCtx, input: StopAgentInput): Promise<StopAgentResult> {
  const { machineId, chatroomId, role, reason } = input;

  const now = Date.now();

  // Look up the agent config first so we can include PID in the event and
  // eagerly clear spawn state in a single pass (no duplicate DB read).
  const stopChatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  let teamConfig = null;
  if (stopChatroom?.teamId) {
    const stopTeamRoleKey = buildTeamRoleKey(chatroomId, stopChatroom.teamId, role);
    teamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', stopTeamRoleKey))
      .first();
  }

  // Dispatch stop via event stream (daemon reads agent.requestStop events).
  // Include the PID so the daemon can target the exact process even after a restart.
  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.requestStop',
    chatroomId,
    machineId,
    role,
    reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
    pid: teamConfig?.spawnedAgentPid ?? undefined,
  });

  // Transition participant status to 'agent.exited' so the UI shows OFFLINE
  // immediately rather than waiting for the daemon to confirm the exit.
  await transitionAgentStatus(ctx, chatroomId, role, 'agent.exited', 'stopped');

  // Mark the agent config as desired-stopped and eagerly clear spawn state
  // so that subsequent queries (e.g. isAlive) reflect the stop immediately.
  if (teamConfig) {
    await ctx.db.patch('chatroom_teamAgentConfigs', teamConfig._id, {
      desiredState: 'stopped',
      spawnedAgentPid: undefined,
      spawnedAt: undefined,
    });
  }

  return {};
}
