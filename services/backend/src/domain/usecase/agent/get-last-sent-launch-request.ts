import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getTeamStructure } from '../../entities/team-presets';
import { getActiveTeamStructure } from '../team/active-team-structure';

type DbCtx = QueryCtx | MutationCtx;
type LastSentLaunchRequest = Doc<'chatroom_agentLastSentLaunchRequests'>;

export async function getLastSentLaunchRequestForRole(
  ctx: DbCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    teamStructureId?: string | undefined;
  }
): Promise<LastSentLaunchRequest | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const structureId =
    args.teamStructureId ??
    (await getActiveTeamStructure(ctx, args.chatroomId))?.teamStructureId ??
    (chatroom?.teamId ? getTeamStructure({ teamId: chatroom.teamId }).teamStructureId : undefined);
  if (!structureId) return null;

  const requestKey = `${args.chatroomId}:${structureId}:${args.role.trim().toLowerCase()}`;
  return (
    (await ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_requestKey', (q) => q.eq('requestKey', requestKey))
      .first()) ?? null
  );
}

export async function listLastSentLaunchRequestsForChatroom(
  ctx: DbCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamStructureId?: string | undefined }
): Promise<LastSentLaunchRequest[]> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const structureId =
    args.teamStructureId ??
    (await getActiveTeamStructure(ctx, args.chatroomId))?.teamStructureId ??
    (chatroom?.teamId ? getTeamStructure({ teamId: chatroom.teamId }).teamStructureId : undefined);
  if (!structureId) return [];

  const rows = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
    .collect();
  return rows.filter((row) => row.teamStructureId === structureId);
}
