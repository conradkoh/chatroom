import { projectAgentStopStateForRole } from './project-agent-operational-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export async function rollupAgentStopCommandStatus(
  ctx: MutationCtx,
  stopCommandId: Id<'chatroom_agentStopCommands'>
): Promise<void> {
  const command = await ctx.db.get('chatroom_agentStopCommands', stopCommandId);
  if (
    !command ||
    command.status === 'completed' ||
    command.status === 'failed' ||
    command.status === 'superseded'
  )
    return;
  const executions = await ctx.db
    .query('chatroom_agentStopMachineExecutions')
    .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
    .collect();
  const targets = await ctx.db
    .query('chatroom_agentStopTargets')
    .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
    .collect();
  const terminal = (status: string) =>
    status === 'completed' || status === 'failed' || status === 'superseded';
  if (
    (!executions.length && !targets.length) ||
    !executions.every((e) => terminal(e.status)) ||
    !targets.every((t) => terminal(t.status))
  )
    return;
  const failed =
    executions.some((e) => e.status === 'failed') || targets.some((t) => t.status === 'failed');
  await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, {
    status: failed ? 'failed' : 'completed',
    completedAt: Date.now(),
  });
  if (!failed && command.postStopDesiredState) {
    const room = await ctx.db.get('chatroom_rooms', command.chatroomId);
    if (room?.teamId)
      for (const role of [...new Set(targets.map((target) => target.role))]) {
        const config = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) =>
            q.eq('teamRoleKey', buildTeamRoleKey(command.chatroomId, room.teamId!, role))
          )
          .first();
        if (config && config.desiredState !== command.postStopDesiredState)
          await patchTeamAgentConfig(
            ctx,
            config._id,
            { desiredState: command.postStopDesiredState },
            { projectScope: 'chatroom' }
          );
      }
  }
  for (const role of [...new Set(targets.map((target) => target.role))])
    await projectAgentStopStateForRole(ctx, command.chatroomId, role);
}
