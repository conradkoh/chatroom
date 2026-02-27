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

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { StopAgentReason } from '../../entities/agent';

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
   * Examples: 'user-stop', 'dedup-stop'
   */
  reason: StopAgentReason;
}

/** Result of a stop-agent operation. */
export interface StopAgentResult {
  /** The ID of the dispatched command record. */
  commandId: Id<'chatroom_machineCommands'>;
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
  const { machineId, chatroomId, role, userId, reason } = input;

  const now = Date.now();
  const commandId = await ctx.db.insert('chatroom_machineCommands', {
    machineId,
    type: 'stop-agent',
    payload: {
      chatroomId,
      role,
    },
    reason,
    status: 'pending',
    sentBy: userId,
    createdAt: now,
  });

  // Mark the agent config as desired-stopped so ensureAgentHandler won't auto-restart it.
  const teamConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .first();

  if (teamConfig) {
    await ctx.db.patch('chatroom_teamAgentConfigs', teamConfig._id, {
      desiredState: 'stopped',
    });
  }

  return { commandId };
}
