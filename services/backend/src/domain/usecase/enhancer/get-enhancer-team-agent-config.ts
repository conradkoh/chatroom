import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';

export async function getEnhancerTeamAgentConfig(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  teamId: string
): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  return ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, teamId, 'enhancer'))
    )
    .first();
}

/**
 * Synchronize the legacy per-user enhancer settings into the runtime team-role
 * config used by job creation and daemon startup. Safe to call repeatedly.
 */
export async function syncEnhancerTeamAgentConfig(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    teamId: string;
    legacyConfig: Doc<'chatroom_enhancerConfigs'>;
  }
): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  const teamRoleKey = buildTeamRoleKey(args.chatroomId, args.teamId, 'enhancer');
  const existing = await getEnhancerTeamAgentConfig(ctx, args.chatroomId, args.teamId);
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom_machine_workingDir', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('machineId', args.legacyConfig.machineId)
    )
    .collect();
  const activeWorkspaces = workspaces.filter((workspace) => workspace.removedAt === undefined);
  const workingDir =
    (existing?.machineId === args.legacyConfig.machineId ? existing.workingDir : undefined) ??
    (activeWorkspaces.length === 1 ? activeWorkspaces[0].workingDir : undefined);

  await upsertTeamAgentConfigByTeamRoleKey(ctx, {
    teamRoleKey,
    ...(existing?.createdAt !== undefined ? { createdAt: existing?.createdAt } : {}),
    fields: {
      chatroomId: args.chatroomId,
      role: 'enhancer',
      type: 'remote',
      machineId: args.legacyConfig.machineId,
      agentHarness: args.legacyConfig.agentHarness,
      model: args.legacyConfig.model,
      workingDir,
      enabled: args.legacyConfig.enabled,
      // Ephemeral agents are never started as part of the persistent team.
      desiredState: existing?.desiredState ?? 'stopped',
      circuitState: existing?.circuitState ?? 'closed',
      lifecycleRevision: existing?.lifecycleRevision ?? 0,
      updatedAt: Date.now(),
    },
  });

  return ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();
}

export function isCompleteRemoteEnhancerConfig(
  config: Doc<'chatroom_teamAgentConfigs'> | null | undefined
): boolean {
  return config?.enabled === true && hasRemoteEnhancerConfigFields(config);
}

export function hasRemoteEnhancerConfigFields(
  config: Doc<'chatroom_teamAgentConfigs'> | null | undefined
): boolean {
  return Boolean(
    config?.type === 'remote' &&
    config.machineId?.trim() &&
    config.model?.trim() &&
    config.agentHarness &&
    config.workingDir?.trim()
  );
}
