import type { BuiltinTeamRole } from '@workspace/shared/domain/agent-role';
import type { TeamPresetId } from '@workspace/shared/domain/team-presets';

import { resolveFallbackRoleIdentity } from '../role-identity-fallback';
import type { RoleIdentity } from '../types/role-identity';
import type { SelectorContext } from '../types/sections';
import { CUSTOM_TEAM_ROLE_IDENTITY } from './custom/prompts/role-identity';
import { getDuoRoleGuidanceFromContext } from './duo/prompts/fromContext';
import { DUO_ROLE_IDENTITY } from './duo/prompts/role-identity';
import { getSoloRoleGuidanceFromContext } from './solo/prompts/fromContext';
import { SOLO_ROLE_IDENTITY } from './solo/prompts/role-identity';
import { getTrioRoleGuidanceFromContext } from './trio/prompts/fromContext';
import { TRIO_ROLE_IDENTITY } from './trio/prompts/role-identity';

/**
 * Everything a preset team owns. Dispatch sites read this table and nothing else.
 */
interface TeamPromptModule<T extends TeamPresetId> {
  readonly teamId: T;
  readonly roleIdentity: { readonly [R in BuiltinTeamRole<T>]: RoleIdentity };
  /** Team guidance for the roles it handles. `null` means the base guidance applies. */
  readonly getRoleGuidance: (ctx: SelectorContext) => string | null;
}

export const TEAM_PROMPT_MODULES = {
  duo: {
    teamId: 'duo',
    roleIdentity: DUO_ROLE_IDENTITY,
    getRoleGuidance: getDuoRoleGuidanceFromContext,
  },
  solo: {
    teamId: 'solo',
    roleIdentity: SOLO_ROLE_IDENTITY,
    getRoleGuidance: getSoloRoleGuidanceFromContext,
  },
  trio: {
    teamId: 'trio',
    roleIdentity: TRIO_ROLE_IDENTITY,
    getRoleGuidance: getTrioRoleGuidanceFromContext,
  },
} satisfies { [T in TeamPresetId]: TeamPromptModule<T> };

type IdentityTable = Readonly<Partial<Record<string, RoleIdentity>>>;

function ownIdentity(table: IdentityTable, role: string): RoleIdentity | undefined {
  return Object.prototype.hasOwnProperty.call(table, role) ? table[role] : undefined;
}

/** True when `team` names a preset team. Prototype keys are not preset teams. */
export function isPresetTeam(team: string): team is TeamPresetId {
  return Object.prototype.hasOwnProperty.call(TEAM_PROMPT_MODULES, team);
}

/**
 * Resolve a role's title and description.
 * 1. A preset team that owns the role → that team's entry, by reference.
 * 2. Otherwise → the frozen legacy catalogue (unknown/custom teams, roles outside the preset).
 * 3. Otherwise → the shared fallback (custom `tester`, ephemeral/retired roles, generic text).
 */
export function resolveRoleIdentity(ctx: Pick<SelectorContext, 'team' | 'role'>): RoleIdentity {
  const role = ctx.role.toLowerCase();
  if (isPresetTeam(ctx.team)) {
    const owned = ownIdentity(TEAM_PROMPT_MODULES[ctx.team].roleIdentity, role);
    if (owned) return owned;
  }
  return ownIdentity(CUSTOM_TEAM_ROLE_IDENTITY, role) ?? resolveFallbackRoleIdentity(ctx.role);
}
