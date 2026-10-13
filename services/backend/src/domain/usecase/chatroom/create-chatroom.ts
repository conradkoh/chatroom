import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getTeamStructure } from '../../entities/team-presets';
import { ensureMessageReadModelState } from '../message/message-read-model';
import { upsertActiveTeamStructure } from '../team/active-team-structure';

/**
 * The only place that writes a new chatroom: the room row, its active team structure, and its
 * message read-model state. Both `chatrooms.create` and `createWithWorkspace` call this.
 *
 * Callers must validate their input before calling, because this function writes immediately.
 */
export async function insertChatroomWithTeam(
  ctx: MutationCtx,
  input: { ownerId: Id<'users'>; teamStructureId: string; name?: string | undefined }
): Promise<Id<'chatroom_rooms'>> {
  const structure = getTeamStructure({ teamId: input.teamStructureId });
  const chatroomId = await ctx.db.insert('chatroom_rooms', {
    status: 'active',
    ownerId: input.ownerId,
    ...(input.name ? { name: input.name } : {}),
  });
  await upsertActiveTeamStructure(ctx, {
    chatroomId,
    teamStructureId: structure.teamStructureId,
    updatedBy: input.ownerId,
  });
  await ensureMessageReadModelState(ctx, chatroomId);
  return chatroomId;
}
