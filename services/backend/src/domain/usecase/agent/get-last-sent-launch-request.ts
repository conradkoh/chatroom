import { requestBelongsToWorkspace } from './workspace-match';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getActiveTeamStructure } from '../team/active-team-structure';

type DbCtx = QueryCtx | MutationCtx;
type LastSentLaunchRequest = Doc<'chatroom_agentLastSentLaunchRequests'>;

export async function getLastSentLaunchRequestForRole(
  ctx: DbCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    teamStructureId?: string | undefined;
    workspaceId?: Id<'chatroom_workspaces'> | undefined;
  }
): Promise<LastSentLaunchRequest | null> {
  const structureId =
    args.teamStructureId ?? (await getActiveTeamStructure(ctx, args.chatroomId))?.teamStructureId;
  if (!structureId) return null;

  const role = args.role.trim().toLowerCase();
  if (args.workspaceId) {
    const scopedKey = `${args.chatroomId}:${structureId}:${args.workspaceId}:${role}`;
    const scoped = await ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_requestKey', (q) => q.eq('requestKey', scopedKey))
      .first();
    if (scoped) return scoped;

    // Legacy snapshots did not include workspaceId in their key. They remain
    // usable only when their machine/path identifies this exact workspace;
    // never fall back to an arbitrary chatroom-level snapshot.
    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) return null;
    const legacyRows = await ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
      .collect();
    return (
      legacyRows
        .filter(
          (row) => row.teamStructureId === structureId && requestBelongsToWorkspace(row, workspace)
        )
        .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null
    );
  }

  const requestKey = `${args.chatroomId}:${structureId}:${role}`;
  const legacy = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_requestKey', (q) => q.eq('requestKey', requestKey))
    .first();
  if (legacy) return legacy;

  // New workspace-scoped snapshots are still discoverable by daemon events
  // that only identify chatroom + role. Prefer the newest one as the
  // compatibility behavior while workspace-aware callers use the scoped path.
  const scopedRows = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .collect();
  return (
    scopedRows
      .filter((row) => row.teamStructureId === structureId)
      .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null
  );
}

export async function listLastSentLaunchRequestsForChatroom(
  ctx: DbCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamStructureId?: string | undefined }
): Promise<LastSentLaunchRequest[]> {
  const structureId =
    args.teamStructureId ?? (await getActiveTeamStructure(ctx, args.chatroomId))?.teamStructureId;
  if (!structureId) return [];

  const rows = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
    .collect();
  return rows.filter((row) => row.teamStructureId === structureId);
}
