/**
 * Use Case: Ensure Only Agent For Role
 *
 * When an agent registers or starts for a given role in a chatroom, any other
 * remote agents already registered for that same role should be stopped.  This
 * prevents duplicate agents from running simultaneously for the same role.
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import { requestWorkspaceAgentStop } from './request-chatroom-workspace-agent-stop';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';

export interface EnsureOnlyAgentForRoleInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  excludeMachineId?: string | undefined;
}

// fallow-ignore-next-line complexity
export async function ensureOnlyAgentForRole(
  ctx: MutationCtx,
  input: EnsureOnlyAgentForRoleInput
): Promise<void> {
  const { chatroomId, role, excludeMachineId } = input;

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const allConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const currentTeamConfigs = filterTeamAgentConfigsForTeam(
    allConfigs,
    chatroomId,
    chatroom?.teamId
  );
  const configs = currentTeamConfigs.filter((c) => c.role.toLowerCase() === role.toLowerCase());

  const conflicting = configs.filter(
    (config) =>
      config.type === 'remote' && config.machineId != null && config.machineId !== excludeMachineId
  );

  for (const config of conflicting)
    if (config.machineId)
      await requestWorkspaceAgentStop(ctx, {
        chatroomId,
        machineId: config.machineId,
        role,
      });
}
