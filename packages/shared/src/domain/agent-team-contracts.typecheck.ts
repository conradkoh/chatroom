// fallow-ignore-file unused-file
import {
  AgentRoleLifecycleTag,
  AGENT_ROLE_DEFINITIONS,
  type AgentRoleMetadata,
  type BuiltinAgentRole,
  type BuiltinTeamRole,
} from './agent-role';
import {
  getTeamStructure,
  TEAM_PRESETS,
  type BuiltinTeamPreset,
  type TeamStructure,
} from './team-presets';

// Each expected error exercises a production type constraint used by projections.
// @ts-expect-error Every builtin role must declare at least one team.
const missingTeams: AgentRoleMetadata = { tags: [AgentRoleLifecycleTag.Permanent] };
// @ts-expect-error Membership must be a nonempty tuple.
const emptyTeams: AgentRoleMetadata = { tags: [AgentRoleLifecycleTag.Permanent], teams: [] };
const twoLifecycles: AgentRoleMetadata = {
  // @ts-expect-error Builtin role metadata declares exactly one lifecycle.
  tags: [AgentRoleLifecycleTag.Permanent, AgentRoleLifecycleTag.Ephemeral],
  teams: [{ teamId: 'duo', order: 10 }],
};
const invalidTeam: AgentRoleMetadata = {
  tags: [AgentRoleLifecycleTag.Permanent],
  // @ts-expect-error Membership team IDs come from the shared team-kind tuple.
  teams: [{ teamId: 'other', order: 10 }],
};
const mismatchedIdentity: typeof AGENT_ROLE_DEFINITIONS.planner = {
  ...AGENT_ROLE_DEFINITIONS.planner,
  // @ts-expect-error A definition's role identity must match its metadata key.
  role: 'triage',
};
// @ts-expect-error Builtin role names derive from metadata keys.
const customBuiltin: BuiltinAgentRole = 'reviewer';
// @ts-expect-error The solo-only role is not a Duo builtin member.
const duoSoloRole: BuiltinTeamRole<'duo'> = 'solo';

const duoPreset: BuiltinTeamPreset<'duo'> = { ...TEAM_PRESETS.duo };
// @ts-expect-error An ephemeral role cannot be a builtin team entry point.
const ephemeralEntry: BuiltinTeamPreset<'duo'> = { ...duoPreset, entryPoint: 'architect' };
const soloPreset: BuiltinTeamPreset<'solo'> = { ...TEAM_PRESETS.solo };
// @ts-expect-error Entry points must belong to their preset's team.
const outOfTeamEntry: BuiltinTeamPreset<'solo'> = { ...soloPreset, entryPoint: 'planner' };

const customStructure: TeamStructure = {
  teamId: 'custom',
  teamStructureId: 'custom',
  teamName: 'Custom',
  entryPoint: 'reviewer',
  roles: [{ role: 'reviewer', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false }],
};
const customResolvedStructure = getTeamStructure({
  teamId: 'custom',
  persistedRoles: ['reviewer'],
  persistedEntryPoint: 'reviewer',
});

void [
  missingTeams,
  emptyTeams,
  twoLifecycles,
  invalidTeam,
  mismatchedIdentity,
  customBuiltin,
  duoSoloRole,
  ephemeralEntry,
  outOfTeamEntry,
  customStructure,
  customResolvedStructure,
];
