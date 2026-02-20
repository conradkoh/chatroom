/**
 * Use Case: Upsert Agent Desired State
 *
 * Writes the desired agent lifecycle state for a chatroom+role using
 * last-write-wins semantics. Only writes if the new requestedAt timestamp
 * is strictly newer than the existing one.
 *
 * This prevents race conditions where a stale auto-restart overwrites
 * a newer manual stop (or vice versa).
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness } from '../../model/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpsertDesiredStateInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  desiredStatus: 'running' | 'stopped';
  requestedAt: number;
  requestedBy: 'user' | 'auto_restart';
  machineId?: string;
  model?: string;
  agentHarness?: AgentHarness;
  workingDir?: string;
}

export interface UpsertDesiredStateResult {
  written: boolean;
  reason: 'ok' | 'stale';
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Upsert the desired state for a chatroom+role.
 *
 * Only writes if `requestedAt > existing.requestedAt` (or no existing row).
 * The entire row is overwritten — each event is the full state, not a delta.
 */
export async function upsertDesiredState(
  ctx: MutationCtx,
  input: UpsertDesiredStateInput
): Promise<UpsertDesiredStateResult> {
  const existing = await ctx.db
    .query('chatroom_machineAgentDesiredState')
    .withIndex('by_chatroom_role', (q) =>
      q.eq('chatroomId', input.chatroomId).eq('role', input.role)
    )
    .first();

  if (existing && existing.requestedAt >= input.requestedAt) {
    return { written: false, reason: 'stale' };
  }

  const state = {
    chatroomId: input.chatroomId,
    role: input.role,
    desiredStatus: input.desiredStatus,
    requestedAt: input.requestedAt,
    requestedBy: input.requestedBy,
    machineId: input.machineId,
    model: input.model,
    agentHarness: input.agentHarness,
    workingDir: input.workingDir,
  };

  if (existing) {
    await ctx.db.replace('chatroom_machineAgentDesiredState', existing._id, state);
  } else {
    await ctx.db.insert('chatroom_machineAgentDesiredState', state);
  }

  return { written: true, reason: 'ok' };
}
