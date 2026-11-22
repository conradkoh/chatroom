import type { BuiltinTeamRole } from '@workspace/shared/domain/agent-role';
import type { TeamPresetId } from '@workspace/shared/domain/team-presets';

import { resolveFallbackRoleIdentity } from '../role-identity-fallback';
import type { RoleIdentity } from '../types/role-identity';
import type { SelectorContext } from '../types/sections';
import { CUSTOM_TEAM_ROLE_IDENTITY } from './custom/prompts/role-identity';
import { DUO_ROLE_IDENTITY } from './duo/prompts/role-identity';
import { SOLO_ROLE_IDENTITY } from './solo/prompts/role-identity';
import { TRIO_ROLE_IDENTITY } from './trio/prompts/role-identity';

interface TeamPromptModule<T extends TeamPresetId> {
  readonly teamId: T;
  readonly roleIdentity: { readonly [R in BuiltinTeamRole<T>]: RoleIdentity };
}

export const TEAM_PROMPT_MODULES = {
  duo: { teamId: 'duo', roleIdentity: DUO_ROLE_IDENTITY },
  solo: { teamId: 'solo', roleIdentity: SOLO_ROLE_IDENTITY },
  trio: { teamId: 'trio', roleIdentity: TRIO_ROLE_IDENTITY },
} satisfies { [T in TeamPresetId]: TeamPromptModule<T> };

type IdentityTable = Readonly<Partial<Record<string, RoleIdentity>>>;

function ownIdentity(table: IdentityTable, role: string): RoleIdentity | undefined {
  return Object.prototype.hasOwnProperty.call(table, role) ? table[role] : undefined;
}

function isPresetTeam(team: string): team is TeamPresetId {
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
