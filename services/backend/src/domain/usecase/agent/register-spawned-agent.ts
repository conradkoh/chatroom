import { getAgentRuntimeState, patchAgentRuntimeState } from './agent-runtime-state';
import { authorizeAgentStart } from './authorize-agent-start';
import type { AuthorizeAgentStartReason } from './authorize-agent-start';
import { recordAgentSpawnedState } from './record-agent-spawned-state';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export type RegisterSpawnedAgentArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  model?: string | undefined;
  harnessSessionId?: string | undefined;
  reason?: string | undefined;
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
    .query('chatroom_agentDesiredConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, args.role))
    )
    .first();
  if (!config) return { accepted: false, reason: 'not_configured' };
  const runtime = await getAgentRuntimeState(ctx, config._id);
  if (runtime?.pid === args.pid) return { accepted: true };
  await patchAgentRuntimeState(ctx, config, {
    pid: args.pid,
    startedAt: Date.now(),
    status: 'waiting',
    machineId: args.machineId,
    actualWorkingDir: config.workingDir,
    actualHarness: config.agentHarness,
    actualModel: args.model ?? config.model,
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
