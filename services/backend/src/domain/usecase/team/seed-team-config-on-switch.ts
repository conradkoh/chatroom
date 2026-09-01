/**
 * Seed missing target-team agent config rows on team switch.
 *
 * Precedence:
 * 1. Outgoing team entry-point role's machineId (from preserved configs)
 * 2. Machine config favorites[0] for target team+role on that machine
 * 3. workingDir from entry-point config, else first active chatroom workspace on that machine
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildMachineFavoriteScopeKey } from '../../../../convex/utils/machineFavoriteScopeKey';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { CodexMaxReasoningLevel } from '../../entities/harness/codex-sdk.model-variants';

export interface SeedTeamAgentConfigInput {
  ctx: MutationCtx;
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  targetTeamId: string;
  targetRole: string;
  previousChatroom: Doc<'chatroom_rooms'> | null;
  existingTeamConfigs: Doc<'chatroom_teamAgentConfigs'>[];
}

export type SeedTeamAgentConfigFields = {
  machineId: string;
  agentHarness: NonNullable<Doc<'chatroom_teamAgentConfigs'>['agentHarness']>;
  model: string;
  workingDir: string;
  maxReasoningLevel?: CodexMaxReasoningLevel;
};

async function resolveWorkingDirFallback(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  hintWorkingDir?: string
): Promise<string | undefined> {
  if (hintWorkingDir) return hintWorkingDir;

  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const active = workspaces
    .filter((w) => w.machineId === machineId && w.removedAt == null)
    .sort((a, b) => b.registeredAt - a.registeredAt);

  return active[0]?.workingDir;
}

// fallow-ignore-next-line complexity
export async function buildSeedTeamAgentConfigFields(
  input: SeedTeamAgentConfigInput
): Promise<SeedTeamAgentConfigFields | null> {
  const {
    ctx,
    chatroomId,
    userId,
    targetTeamId,
    targetRole,
    previousChatroom,
    existingTeamConfigs,
  } = input;

  const oldTeamId = previousChatroom?.teamId;
  if (!oldTeamId) return null;

  const oldEntryPoint =
    previousChatroom?.teamEntryPoint ?? previousChatroom?.teamRoles?.[0] ?? undefined;
  if (!oldEntryPoint) return null;

  const entryKey = buildTeamRoleKey(chatroomId, oldTeamId, oldEntryPoint);
  const entryConfig = existingTeamConfigs.find((c) => c.teamRoleKey === entryKey);
  const seedMachineId = entryConfig?.machineId;
  if (!seedMachineId) return null;

  const favoriteScopeKey = buildMachineFavoriteScopeKey(targetTeamId, targetRole);
  const favoritesRow = await ctx.db
    .query('chatroom_machineConfigFavorites')
    .withIndex('by_user_machine_teamRole', (q) =>
      q.eq('userId', userId).eq('machineId', seedMachineId).eq('teamRoleKey', favoriteScopeKey)
    )
    .first();
  const favorite = favoritesRow?.favorites?.[0];

  const agentHarness = favorite?.agentHarness ?? entryConfig?.agentHarness ?? 'opencode';
  const model = favorite?.model ?? entryConfig?.model;
  const workingDir = await resolveWorkingDirFallback(
    ctx,
    chatroomId,
    seedMachineId,
    entryConfig?.workingDir
  );

  if (!model || !workingDir) return null;

  const maxReasoningLevel =
    agentHarness === 'codex-sdk' ? entryConfig?.maxReasoningLevel : undefined;

  return {
    machineId: seedMachineId,
    agentHarness,
    model,
    workingDir,
    ...(maxReasoningLevel !== undefined ? { maxReasoningLevel } : {}),
  };
}
