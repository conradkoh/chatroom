import { buildAgentRestartEvent } from './build-agent-restart-event';
import { resolvePlannerRestartOnHandoffToUser } from './resolve-planner-restart-on-handoff-to-user';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { transitionAgentStatus } from './transition-agent-status';

export async function restartPlannerOnHandoffToUser(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamId: string }
): Promise<void> {
  const key = buildTeamRoleKey(args.chatroomId, args.teamId, 'planner');
  const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', q => q.eq('teamRoleKey', key)).first();
  if (!resolvePlannerRestartOnHandoffToUser(config)) return;
  if (config?.type !== 'remote' || !config.machineId || !config.agentHarness || !config.model || !config.workingDir) return;
  const correlationId = crypto.randomUUID();
  await ctx.db.insert('chatroom_eventStream', buildAgentRestartEvent({ chatroomId: args.chatroomId, machineId: config.machineId, role: 'planner', agentHarness: config.agentHarness, model: config.model, workingDir: config.workingDir, correlationId, wantResume: false }, Date.now()));
  await transitionAgentStatus(ctx, args.chatroomId, 'planner', 'agent.restart', 'running');
}
