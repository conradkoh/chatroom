import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';

type CompleteRemoteConfig = Doc<'chatroom_teamAgentConfigs'> & {
  type: 'remote';
  machineId: string;
  model: string;
  agentHarness: NonNullable<Doc<'chatroom_teamAgentConfigs'>['agentHarness']>;
  workingDir: string;
};

// fallow-ignore-next-line complexity unused-export
export function isCompleteRemoteTeamAgentConfig(
  config: Doc<'chatroom_teamAgentConfigs'> | null | undefined
): config is CompleteRemoteConfig {
  if (config?.type !== 'remote') return false;
  return Boolean(
    config.machineId?.trim() &&
    config.model?.trim() &&
    config.agentHarness &&
    config.workingDir?.trim()
  );
}

function preserveExistingTimestamps(
  existing: Doc<'chatroom_teamAgentConfigs'> | null | undefined
): { createdAt: number } | Record<string, never> {
  return existing?.createdAt !== undefined ? { createdAt: existing.createdAt } : {};
}

/** Arm ephemeral builder config from the coordinator's remote config before daemon wake. */
// fallow-ignore-next-line complexity
export async function syncBuilderTeamAgentConfigFromCoordinator(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; teamId: string; coordinatorRole: string }
): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  if (!isEphemeralAgentRole('builder')) return null;

  const coordinatorKey = buildTeamRoleKey(args.chatroomId, args.teamId, args.coordinatorRole);
  const coordinatorConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', coordinatorKey))
    .first();
  if (!isCompleteRemoteTeamAgentConfig(coordinatorConfig)) return null;

  const teamRoleKey = buildTeamRoleKey(args.chatroomId, args.teamId, 'builder');
  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  await upsertTeamAgentConfigByTeamRoleKey(ctx, {
    teamRoleKey,
    ...preserveExistingTimestamps(existing),
    fields: {
      chatroomId: args.chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: coordinatorConfig.machineId,
      agentHarness: coordinatorConfig.agentHarness,
      model: coordinatorConfig.model,
      workingDir: coordinatorConfig.workingDir,
      enabled: true,
      desiredState: 'running', // armed for wake; no PID until daemon spawns
      wantResume: false,
      circuitState: existing?.circuitState ?? 'closed',
      lifecycleRevision: existing?.lifecycleRevision ?? 0,
      updatedAt: Date.now(),
    },
  });

  // fallow-ignore-next-line code-duplication
  return ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();
}
