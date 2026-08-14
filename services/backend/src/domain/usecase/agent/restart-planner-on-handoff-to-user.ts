import { requestAgentRestart } from './request-agent-restart';
import { resolvePlannerRestartOnHandoffToUser } from './resolve-planner-restart-on-handoff-to-user';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export async function restartPlannerOnHandoffToUser(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamId: string }
): Promise<void> {
  const key = buildTeamRoleKey(args.chatroomId, args.teamId, 'planner');
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', key))
    .first();
  if (!resolvePlannerRestartOnHandoffToUser(config)) return;
  await requestAgentRestart(ctx, {
    chatroomId: args.chatroomId,
    role: 'planner',
    request: { reason: 'platform.planner_handoff_to_user' },
  });
}
