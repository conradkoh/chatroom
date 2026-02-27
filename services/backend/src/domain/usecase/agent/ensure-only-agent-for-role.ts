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

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnsureOnlyAgentForRoleInput {
  /** The chatroom whose agent configs should be checked. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role to deduplicate (e.g. "builder", "reviewer"). */
  role: string;
  /** The user dispatching the stop commands. */
  userId: Id<'users'>;
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
 * Dispatches a `stop-agent` command for every conflicting remote config found.
 */
export async function ensureOnlyAgentForRole(
  ctx: MutationCtx,
  input: EnsureOnlyAgentForRoleInput
): Promise<void> {
  const { chatroomId, role, userId, excludeMachineId } = input;

  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .collect();

  const conflicting = configs.filter(
    (config) =>
      config.type === 'remote' && config.machineId != null && config.machineId !== excludeMachineId
  );

  for (const config of conflicting) {
    await ctx.db.insert('chatroom_machineCommands', {
      machineId: config.machineId as string,
      type: 'stop-agent',
      payload: { chatroomId, role },
      reason: 'dedup-stop',
      status: 'pending',
      sentBy: userId,
      createdAt: Date.now(),
    });
  }
}
