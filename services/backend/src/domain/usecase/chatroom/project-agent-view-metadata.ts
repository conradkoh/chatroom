import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type AgentViewMetadataInput = {
  chatroomId: Id<'chatroom_rooms'>;
  ownerId: Id<'users'>;
  teamId: string;
  teamName: string;
  teamRoles: string[];
  hasHistory?: boolean | undefined;
};

export async function upsertAgentViewMetadata(
  ctx: MutationCtx,
  input: AgentViewMetadataInput
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_agentViewMetadata')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .first();
  const hasHistory = Boolean(existing?.hasHistory || input.hasHistory);
  if (
    existing &&
    existing.ownerId === input.ownerId &&
    existing.teamId === input.teamId &&
    existing.teamName === input.teamName &&
    existing.teamRoles.length === input.teamRoles.length &&
    existing.teamRoles.every((r, i) => r === input.teamRoles[i]) &&
    existing.hasHistory === hasHistory
  )
    return;
  const fields = {
    ownerId: input.ownerId,
    teamId: input.teamId,
    teamName: input.teamName,
    teamRoles: input.teamRoles,
    hasHistory,
  };
  if (existing) await ctx.db.patch('chatroom_agentViewMetadata', existing._id, fields);
  else
    await ctx.db.insert('chatroom_agentViewMetadata', { chatroomId: input.chatroomId, ...fields });
}

export async function markAgentViewHasHistory(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const row = await ctx.db
    .query('chatroom_agentViewMetadata')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (row && !row.hasHistory)
    await ctx.db.patch('chatroom_agentViewMetadata', row._id, { hasHistory: true });
}

export async function deleteAgentViewMetadata(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const row = await ctx.db
    .query('chatroom_agentViewMetadata')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (row) await ctx.db.delete('chatroom_agentViewMetadata', row._id);
}
