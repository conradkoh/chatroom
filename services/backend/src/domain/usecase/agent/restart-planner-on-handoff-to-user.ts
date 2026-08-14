import { restartAgent } from './restart-agent';
import { resolvePlannerRestartOnHandoffToUser } from './resolve-planner-restart-on-handoff-to-user';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export async function restartPlannerOnHandoffToUser(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamId: string }
): Promise<void> {
  const key = buildTeamRoleKey(args.chatroomId, args.teamId, 'planner');
  const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', q => q.eq('teamRoleKey', key)).first();
  if (!resolvePlannerRestartOnHandoffToUser(config)) return;
  if (config?.type !== 'remote' || !config.machineId || !config.agentHarness || !config.model || !config.workingDir) return;
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
    .first();
  if (!machine) return;
  await restartAgent(ctx, {
    machineId: config.machineId,
    chatroomId: args.chatroomId,
    role: 'planner',
    userId: machine.userId,
    model: config.model,
    agentHarness: config.agentHarness,
    workingDir: config.workingDir,
    wantResume: config.wantResume,
  }, machine);
}
