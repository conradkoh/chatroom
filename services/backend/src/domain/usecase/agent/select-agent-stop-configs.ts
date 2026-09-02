import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';
import { normalizeAgentStopRole, type AgentStopScope } from '../../entities/agent-stop-command';

export type AgentStopSelectedConfig = Doc<'chatroom_teamAgentConfigs'> & {
  machineId: string;
  spawnedAgentPid: number;
  agentHarness: NonNullable<Doc<'chatroom_teamAgentConfigs'>['agentHarness']>;
};
const stoppable = (c: Doc<'chatroom_teamAgentConfigs'>): c is AgentStopSelectedConfig =>
  c.type === 'remote' && c.machineId != null && c.spawnedAgentPid != null && c.agentHarness != null;
export async function selectCurrentTeamStoppableConfigs(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<AgentStopSelectedConfig[]> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  const all = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  return filterTeamAgentConfigsForTeam(all, chatroomId, room?.teamId).filter(stoppable);
}
export function filterSelectedConfigsForScope(
  configs: AgentStopSelectedConfig[],
  scope: AgentStopScope,
  machineId?: string
) {
  return configs.filter(
    (c) =>
      (!machineId || c.machineId === machineId) &&
      (scope.kind === 'chatroom' ||
        normalizeAgentStopRole(c.role) === normalizeAgentStopRole(scope.role))
  );
}
export async function selectConfigsForAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; scope: AgentStopScope; machineId?: string | undefined }
) {
  return filterSelectedConfigsForScope(
    await selectCurrentTeamStoppableConfigs(ctx, args.chatroomId),
    args.scope,
    args.machineId
  );
}
