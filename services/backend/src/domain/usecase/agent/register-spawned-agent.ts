import { authorizeAgentStart } from './authorize-agent-start';
import type { AuthorizeAgentStartReason } from './authorize-agent-start';
import { recordAgentSpawnedState } from './record-agent-spawned-state';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export type RegisterSpawnedAgentArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  lifecycleRevision: number;
  model?: string;
  harnessSessionId?: string;
  reason?: string;
};
export type RegisterSpawnedAgentResult =
  { accepted: true } | { accepted: false; reason: AuthorizeAgentStartReason };

export async function registerSpawnedAgentIfAuthorized(
  ctx: MutationCtx,
  args: RegisterSpawnedAgentArgs
): Promise<RegisterSpawnedAgentResult> {
  const auth = await authorizeAgentStart(ctx, args);
  if (!auth.allowed) return { accepted: false, reason: auth.reason };
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room?.teamId) return { accepted: false, reason: 'not_configured' };
  const teamId = room.teamId;
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, args.role))
    )
    .first();
  if (!config) return { accepted: false, reason: 'not_configured' };
  if (config.spawnedAgentPid === args.pid) return { accepted: true };
  await patchTeamAgentConfig(ctx, config._id, {
    spawnedAgentPid: args.pid,
    spawnedAt: Date.now(),
    ...(args.model !== undefined ? { model: args.model } : {}),
  });
  await recordAgentSpawnedState(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    machineId: args.machineId,
    pid: args.pid,
    model: args.model,
    harnessSessionId: args.harnessSessionId,
    reason: args.reason,
  });
  return { accepted: true };
}
