import { rebuildAgentOperationalStatusForChatroom } from './project-agent-operational-status';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { releaseTasksOnAgentExit } from '../task/release-tasks-on-agent-exit';

/**
 * Converge all backend chatroom projections after the daemon has stopped the
 * complete chatroom scope. The inbox/daemon owns physical process shutdown;
 * this handler owns the single backend baseline transition.
 */
// fallow-ignore-next-line complexity
export async function shutdownChatroomTeam(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'> }
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return;

  const [allConfigs, statusRows] = await Promise.all([
    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
  ]);
  const configs = room.teamId
    ? filterTeamAgentConfigsForTeam(allConfigs, args.chatroomId, room.teamId)
    : [];
  const roles = new Set<string>(configs.map((config) => config.role.toLowerCase()));
  for (const row of statusRows) roles.add(row.role.toLowerCase());

  for (const config of configs) {
    if (config.desiredState !== 'stopped')
      await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
        desiredState: 'stopped',
        updatedAt: Date.now(),
      });
  }

  for (const role of roles) {
    await releaseTasksOnAgentExit(ctx, { chatroomId: args.chatroomId, role });
    await transitionAgentStatus(ctx, args.chatroomId, role, 'agent.exited', 'stopped');
    const participant = await getParticipantForChatroomRole(ctx, args.chatroomId, role);
    if (participant)
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAction: 'agent.exited',
        connectionId: undefined,
        lastDesiredState: 'stopped',
      });
    if (!configs.some((config) => config.role.toLowerCase() === role))
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId: args.chatroomId,
        role,
        event: { status: 'offline' },
      });
  }

  if (room.teamId)
    await rebuildAgentOperationalStatusForChatroom(ctx, args.chatroomId, undefined, {
      pruneStale: true,
    });
}
