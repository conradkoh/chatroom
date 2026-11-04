/**
 * SelectorContext builders and role-guidance dispatch.
 *
 * Extracted from generator.ts to avoid circular imports with native/system-prompt.ts.
 */

import { getTeamPresetId } from '@workspace/shared/domain/team-presets';

import { getBaseRoleGuidanceFromContext } from './cli/roles/fromContext';
import { getDuoRoleGuidanceFromContext } from './teams/duo/prompts/fromContext';
import { getSoloRoleGuidanceFromContext } from './teams/solo/prompts/fromContext';
import { getTrioRoleGuidanceFromContext } from './teams/trio/prompts/fromContext';
import type { SelectorContext } from './types/sections';
import { getTeamEntryPoint, toTeam } from '../src/domain/entities/team';
import type { TeamKind } from '../src/domain/entities/team-kind';

// fallow-ignore-next-line complexity
function detectTeamTypeByName(teamName?: string): TeamKind | null {
  const normalizedName = (teamName || '').toLowerCase();
  if (normalizedName.includes('solo')) return 'solo';
  if (normalizedName.includes('trio')) return 'trio';
  if (normalizedName.includes('duo')) return 'duo';
  return null;
}

function isSoloTeamByRoles(teamRoles: string[]): boolean {
  const normalizedRoles = teamRoles.map((role) => role.toLowerCase());
  return (
    normalizedRoles.includes('solo') &&
    !normalizedRoles.includes('planner') &&
    !normalizedRoles.includes('builder')
  );
}

function isTrioTeamByRoles(teamRoles: string[]): boolean {
  const normalizedRoles = teamRoles.map((role) => role.toLowerCase());
  return normalizedRoles.includes('coordinator') && normalizedRoles.includes('specifier');
}

function isDuoTeamByRoles(teamRoles: string[]): boolean {
  const normalizedRoles = teamRoles.map((role) => role.toLowerCase());
  return normalizedRoles.includes('planner') && normalizedRoles.includes('builder');
}

// fallow-ignore-next-line complexity
function detectTeamType(
  teamRoles: string[],
  teamName?: string,
  teamId?: string
): TeamKind | 'unknown' {
  const presetId = teamId ? getTeamPresetId(teamId) : undefined;
  if (presetId) return presetId;
  const byName = detectTeamTypeByName(teamName);
  if (byName) return byName;
  if (isSoloTeamByRoles(teamRoles)) return 'solo';
  if (isTrioTeamByRoles(teamRoles)) return 'trio';
  if (isDuoTeamByRoles(teamRoles)) return 'duo';
  return 'unknown';
}

/**
 * Build a SelectorContext from the various parameters used in the generator.
 */
export function buildSelectorContext(params: {
  role: string;
  teamRoles: string[];
  teamName?: string | undefined;
  teamId?: string | undefined;
  teamEntryPoint?: string | undefined;
  convexUrl: string;
  chatroomId?: string | undefined;
  agentType?: 'remote' | 'custom' | 'unset' | undefined;
  nativeIntegration?: boolean | undefined;
}): SelectorContext {
  const entryPoint =
    getTeamEntryPoint({ teamEntryPoint: params.teamEntryPoint, teamRoles: params.teamRoles }) ??
    'builder';
  const teamConfig =
    toTeam({
      teamId: params.teamId,
      teamName: params.teamName,
      teamRoles: params.teamRoles,
      teamEntryPoint: params.teamEntryPoint,
    }) ?? undefined;
  return {
    role: params.role,
    team: detectTeamType(params.teamRoles, params.teamName, params.teamId),
    teamConfig,
    teamRoles: params.teamRoles,
    isEntryPoint: params.role.toLowerCase() === entryPoint.toLowerCase(),
    convexUrl: params.convexUrl,
    chatroomId: params.chatroomId,
    agentType: params.agentType ?? 'unset',
    nativeIntegration: params.nativeIntegration,
  };
}

// fallow-ignore-next-line complexity
export function getRoleGuidanceFromContext(ctx: SelectorContext): string {
  try {
    if (ctx.team === 'solo') {
      const result = getSoloRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }

    if (ctx.team === 'duo') {
      const result = getDuoRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }

    if (ctx.team === 'trio') {
      const result = getTrioRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }
  } catch {
    // Fall back to base guidance
  }

  return getBaseRoleGuidanceFromContext(ctx);
}
