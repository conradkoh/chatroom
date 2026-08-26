import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export async function getEnhancerTeamAgentConfig(ctx: QueryCtx | MutationCtx, chatroomId: Id<'chatroom_rooms'>, teamId: string): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  return ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, teamId, 'enhancer'))).first();
}

export function isCompleteRemoteEnhancerConfig(config: Doc<'chatroom_teamAgentConfigs'> | null | undefined): boolean {
  return Boolean(config?.type === 'remote' && config.enabled === true && config.machineId?.trim() && config.model?.trim() && config.agentHarness && config.workingDir?.trim());
}
