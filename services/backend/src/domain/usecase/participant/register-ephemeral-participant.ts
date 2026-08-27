import { isEphemeralAgentRole, normalizeAgentRole } from '@workspace/shared/domain/agent-role';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAgentRoleStatusReadModel } from '../agent/project-agent-role-status-read-model';

export type RegisterEphemeralParticipantInput = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  connectionId: string;
  action: string;
};

/** Register an active invocation of a role that is not part of the persistent team. */
export async function registerEphemeralParticipant(
  ctx: MutationCtx,
  input: RegisterEphemeralParticipantInput
): Promise<void> {
  const role = normalizeAgentRole(input.role);
  if (!isEphemeralAgentRole(role)) return;

  const existing = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', input.chatroomId).eq('role', role)
    )
    .first();
  const fields = {
    machineId: input.machineId,
    agentType: 'remote' as const,
    lastSeenAt: Date.now(),
    lastSeenAction: input.action,
    connectionId: input.connectionId,
  };

  if (existing) {
    await ctx.db.patch('chatroom_participants', existing._id, fields);
  } else {
    await ctx.db.insert('chatroom_participants', {
      chatroomId: input.chatroomId,
      role,
      ...fields,
    });
  }

  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId: input.chatroomId,
    role,
    event: { status: 'starting' },
  });
}
