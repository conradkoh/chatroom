import { getTeamPreset } from '@workspace/shared/domain/team-presets';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';

export function mergeCanonicalEnhancerIntoTeamRoles(
  teamId: string | undefined | null,
  teamRoles: readonly string[] | undefined | null
): string[] | undefined {
  if (!teamId || !teamRoles?.length) return teamRoles ? [...teamRoles] : undefined;
  const preset = getTeamPreset(teamId);
  if (!preset || teamRoles.some((role) => role.trim().toLowerCase() === 'enhancer'))
    return [...teamRoles];
  const normalized = teamRoles.map((role) => role.trim().toLowerCase());
  if (
    teamId.toLowerCase() === 'duo' &&
    teamRoles.length === 2 &&
    normalized.includes('planner') &&
    normalized.includes('builder')
  )
    return [...preset.roles];
  if (teamId.toLowerCase() === 'solo' && normalized.length === 1 && normalized[0] === 'solo')
    return [...preset.roles];
  return [...teamRoles];
}

export async function resolveEnhancerWorkingDir(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; machineId: string; teamId: string; entryPoint: string }
): Promise<string | undefined> {
  const jobs = await ctx.db
    .query('chatroom_enhancerJobs')
    .withIndex('by_machine_status', (q) => q.eq('machineId', args.machineId))
    .collect();
  const jobDir = jobs
    .filter((job) => job.chatroomId === args.chatroomId && job.workingDir?.trim())
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.workingDir;
  if (jobDir) return jobDir;
  const entryConfig = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, args.teamId, args.entryPoint))
    )
    .first();
  if (entryConfig?.machineId === args.machineId && entryConfig.workingDir?.trim())
    return entryConfig.workingDir;
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom_machine_workingDir', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('machineId', args.machineId)
    )
    .collect();
  const active = workspaces.filter((workspace) => workspace.removedAt === undefined);
  return active.length === 1 && active[0].workingDir?.trim() ? active[0].workingDir : undefined;
}

export async function migrateEnhancerConfigRow(
  ctx: MutationCtx,
  legacy: Doc<'chatroom_enhancerConfigs'>
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', legacy.chatroomId);
  if (!room?.teamId) return;
  const preset = getTeamPreset(room.teamId);
  if (!preset) return;
  const teamRoleKey = buildTeamRoleKey(legacy.chatroomId, room.teamId, 'enhancer');
  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();
  if (existing) return;
  const workingDir = await resolveEnhancerWorkingDir(ctx, {
    chatroomId: legacy.chatroomId,
    machineId: legacy.machineId,
    teamId: room.teamId,
    entryPoint: room.teamEntryPoint ?? preset.entryPoint,
  });
  const now = Date.now();
  await upsertTeamAgentConfigByTeamRoleKey(ctx, {
    teamRoleKey,
    createdAt: now,
    fields: {
      chatroomId: legacy.chatroomId,
      role: 'enhancer',
      type: 'remote',
      machineId: legacy.machineId,
      agentHarness: legacy.agentHarness,
      model: legacy.model,
      workingDir,
      enabled: workingDir?.trim() ? legacy.enabled : false,
      desiredState: 'stopped',
      lifecycleRevision: 0,
      updatedAt: now,
    },
  });
}
