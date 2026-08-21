/**
 * Centralized logic for safe config removal.
 * Emits config.requestRemoval events and processes pending removals.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { teamRoleKeyMatchesTeam } from '../../../../convex/utils/teamRoleKeyFilter';
import { projectAgentOperationalStatusForChatroom } from './project-agent-operational-status';

export type ConfigRemovalReason = 'team_switch' | 'stale_duplicate' | 'manual';

// fallow-ignore-next-line complexity
function configMatchesRemovalTarget(
  config: Doc<'chatroom_teamAgentConfigs'>,
  chatroomId: Id<'chatroom_rooms'>,
  teamId: string | undefined,
  role: string,
  machineId: string
): boolean {
  if (config.role.toLowerCase() !== role.toLowerCase()) return false;
  if (config.machineId !== machineId) return false;
  if (teamId && !teamRoleKeyMatchesTeam(config.teamRoleKey, chatroomId, teamId)) return false;
  return true;
}

/**
 * Emit a config.requestRemoval event to the event stream.
 * Callers use this instead of directly deleting chatroom_teamAgentConfigs rows.
 */
export async function emitConfigRemoval(
  ctx: MutationCtx,
  opts: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    machineId: string;
    reason: ConfigRemovalReason;
  }
): Promise<void> {
  await ctx.db.insert('chatroom_eventStream', {
    type: 'config.requestRemoval',
    chatroomId: opts.chatroomId,
    role: opts.role,
    machineId: opts.machineId,
    reason: opts.reason,
    timestamp: Date.now(),
  });
}

/**
 * Process a pending config removal for a given chatroom+role+machine.
 * Only deletes the config if:
 * 1. A config.requestRemoval event exists for this chatroom+role
 * 2. The config's spawnedAgentPid is cleared (process confirmed dead)
 *
 * Returns true if the config was deleted.
 */
export async function processConfigRemoval(
  ctx: MutationCtx,
  opts: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    machineId: string;
  }
): Promise<boolean> {
  const chatroom = await ctx.db.get('chatroom_rooms', opts.chatroomId);
  const allConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', opts.chatroomId))
    .collect();

  const config = allConfigs.find((c) =>
    configMatchesRemovalTarget(c, opts.chatroomId, chatroom?.teamId, opts.role, opts.machineId)
  );

  if (!config) return false;

  if (config.spawnedAgentPid != null) return false;

  const removalEvents = await ctx.db
    .query('chatroom_eventStream')
    .withIndex('by_chatroomId_role', (q) =>
      q.eq('chatroomId', opts.chatroomId).eq('role', opts.role)
    )
    .order('desc')
    .take(20);

  const hasRemovalRequest = removalEvents.some(
    (e: any) => e.type === 'config.requestRemoval' && e.machineId === opts.machineId
  );

  if (!hasRemovalRequest) return false;

  await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
  await projectAgentOperationalStatusForChatroom(ctx, opts.chatroomId);
  return true;
}
