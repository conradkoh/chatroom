/**
 * Use Case: Ensure Only Agent For Role
 *
 * When an agent registers or starts for a given role in a chatroom, any other
 * remote agents already registered for that same role should be stopped.  This
 * prevents duplicate agents from running simultaneously for the same role.
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionAgentStatus } from './transition-agent-status';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnsureOnlyAgentForRoleInput {
  /** The chatroom whose agent configs should be checked. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role to deduplicate (e.g. "builder", "reviewer"). */
  role: string;
  /**
   * If provided, skip stopping this machine (used when a remote agent is
   * registering itself — we don't want to stop the machine that just registered).
   */
  excludeMachineId?: string;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Stop all remote agents for a given role in a chatroom, except the one
 * identified by `excludeMachineId` (if provided).
 *
 * Emits an `agent.requestStop` event for every conflicting remote config found.
 * The daemon's stream subscription handles these events directly.
 */
export async function ensureOnlyAgentForRole(
  ctx: MutationCtx,
  input: EnsureOnlyAgentForRoleInput
): Promise<void> {
  const { chatroomId, role, excludeMachineId } = input;

  const allConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const configs = allConfigs.filter((c) => c.role.toLowerCase() === role.toLowerCase());

  const conflicting = configs.filter(
    (config) =>
      config.type === 'remote' && config.machineId != null && config.machineId !== excludeMachineId
  );

  const now = Date.now();

  for (const config of conflicting) {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.requestStop',
      chatroomId,
      machineId: config.machineId as string,
      role,
      reason: 'platform.dedup',
      deadline: now + AGENT_REQUEST_DEADLINE_MS,
      timestamp: now,
      pid: config.spawnedAgentPid ?? undefined,
    });

    // Eagerly clear spawn state and mark as stopped so the UI reflects the
    // stop immediately rather than waiting for the daemon to confirm.
    await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
      desiredState: 'stopped',
      spawnedAgentPid: undefined,
      spawnedAt: undefined,
    });

    await transitionAgentStatus(ctx, chatroomId, role, 'agent.exited', 'stopped');
  }
}
