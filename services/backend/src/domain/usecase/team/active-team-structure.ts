import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = MutationCtx | QueryCtx;
export type ActiveTeamStructure = Doc<'chatroom_activeTeamStructures'>;

export async function getActiveTeamStructure(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ActiveTeamStructure | null> {
  return (
    (await ctx.db
      .query('chatroom_activeTeamStructures')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first()) ?? null
  );
}

export async function upsertActiveTeamStructure(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    teamStructureId: string;
    updatedBy: Id<'users'>;
    now?: number;
  }
): Promise<ActiveTeamStructure> {
  const now = input.now ?? Date.now();
  const existing = await getActiveTeamStructure(ctx, input.chatroomId);
  if (existing) {
    await ctx.db.patch('chatroom_activeTeamStructures', existing._id, {
      teamStructureId: input.teamStructureId,
      updatedBy: input.updatedBy,
      updatedAt: now,
    });
    const updated = await ctx.db.get('chatroom_activeTeamStructures', existing._id);
    if (!updated) throw new Error('Failed to update active team structure');
    return updated;
  }

  const id = await ctx.db.insert('chatroom_activeTeamStructures', {
    chatroomId: input.chatroomId,
    teamStructureId: input.teamStructureId,
    updatedBy: input.updatedBy,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get('chatroom_activeTeamStructures', id);
  if (!created) throw new Error('Failed to create active team structure');
  return created;
}
