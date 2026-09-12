import { isEphemeralAgentRole, normalizeAgentRole } from '@workspace/shared/domain/agent-role';

import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

/** Clear ephemeral role presence after on-demand work finishes without a tracked PID. */
// fallow-ignore-next-line complexity
export async function releaseEphemeralAgentRole(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<void> {
  const role = normalizeAgentRole(args.role);
  if (!isEphemeralAgentRole(role)) return;

  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const teamId = room?.teamId;
  if (teamId) {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, role))
      )
      .first();
    if (config && config.desiredState !== 'stopped') {
      await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
        desiredState: 'stopped',
        updatedAt: Date.now(),
      });
    }
  }

  const participant = await getParticipantForChatroomRole(ctx, args.chatroomId, role);

  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAction: PARTICIPANT_EXITED_ACTION,
    });
    await transitionAgentStatus(ctx, args.chatroomId, role, 'agent.exited');
    return;
  }

  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId: args.chatroomId,
    role,
    event: { status: 'offline' },
  });
}
