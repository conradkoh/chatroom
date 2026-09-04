import { isEphemeralAgentRole, normalizeAgentRole } from '@workspace/shared/domain/agent-role';
import { getTeamPreset } from '@workspace/shared/domain/team-presets';

import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// fallow-ignore-next-line complexity
export function mergeCanonicalBuilderIntoTeamRoles(
  teamId: string | undefined | null,
  teamRoles: readonly string[] | undefined | null
): string[] | undefined {
  if (!teamId || !teamRoles?.length) return teamRoles ? [...teamRoles] : undefined;
  const preset = getTeamPreset(teamId);
  if (!preset || !preset.roles.some((r) => r.trim().toLowerCase() === 'builder'))
    return [...teamRoles];
  const normalized = teamRoles.map((r) => r.trim().toLowerCase());
  if (normalized.includes('builder')) return [...teamRoles];
  if (teamId.toLowerCase() === 'solo' && normalized.includes('solo')) {
    const out = [...teamRoles];
    if (!normalized.includes('enhancer')) out.push('enhancer');
    out.push('builder');
    return out;
  }
  return [...teamRoles];
}

/**
 * One-off migration: retire legacy builder agent configs when builder becomes
 * an ephemeral role.
 *
 * Prior to this migration, a duo builder could be started directly (via
 * `startAgent`) so its config could carry a running desiredState and a spawned
 * PID. Under the ephemeral model the builder is armed on demand from the
 * planner config via planner handoff — it should never be left running or with
 * a stale PID.
 *
 * For each builder config still holding an active PID or `desiredState: running`,
 * clear the PID and force `desiredState: stopped` with `wantResume: false`.
 * Configs are never deleted (seed data and machine binding are preserved).
 */
export async function migrateLegacyBuilderConfigRow(
  ctx: MutationCtx,
  row: Doc<'chatroom_teamAgentConfigs'>
): Promise<void> {
  if (!isActiveLegacyBuilder(row)) return;

  await ctx.db.patch('chatroom_teamAgentConfigs', row._id, {
    desiredState: 'stopped',
    wantResume: false,
    ...clearSpawnState(row),
  });
}

// fallow-ignore-next-line complexity
function isActiveLegacyBuilder(row: Doc<'chatroom_teamAgentConfigs'>): boolean {
  if (!isEphemeralAgentRole('builder')) return false;
  if (normalizeAgentRole(row.role) !== 'builder') return false;
  if (!row.teamRoleKey.includes('#team_duo#')) return false;
  return row.desiredState === 'running' || row.spawnedAgentPid !== undefined;
}

function clearSpawnState(row: Doc<'chatroom_teamAgentConfigs'>): {
  spawnedAgentPid?: undefined;
  spawnedAt?: undefined;
} {
  const fields: { spawnedAgentPid?: undefined; spawnedAt?: undefined } = {};
  if (row.spawnedAgentPid !== undefined) fields.spawnedAgentPid = undefined;
  if (row.spawnedAt !== undefined) fields.spawnedAt = undefined;
  return fields;
}
