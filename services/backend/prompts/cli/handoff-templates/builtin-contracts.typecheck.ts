// fallow-ignore-file unused-file
import type { BuiltinAgentRole, BuiltinTeamRole } from '@workspace/shared/domain/agent-role';

import type {
  BuiltinTeamHandoffCatalog,
  BuiltinTeamRoleHandoffContract,
  RoleHandoffContract,
} from './contracts';
import { DUO_ROLE_HANDOFF_CATALOG } from '../../teams/duo/handoff-templates';
import { DUO_ROLE_IDENTITY } from '../../teams/duo/prompts/role-identity';
import { SOLO_ROLE_HANDOFF_CATALOG } from '../../teams/solo/handoff-templates';
import { SOLO_ROLE_IDENTITY } from '../../teams/solo/prompts/role-identity';
import { TRIO_ROLE_HANDOFF_CATALOG } from '../../teams/trio/handoff-templates';
import { TRIO_ROLE_IDENTITY } from '../../teams/trio/prompts/role-identity';
import type { RoleIdentity } from '../../types/role-identity';

// @ts-expect-error the duo identity catalogue requires every duo role
const missingDuoIdentity: { readonly [R in BuiltinTeamRole<'duo'>]: RoleIdentity } = {
  planner: DUO_ROLE_IDENTITY.planner,
};
void missingDuoIdentity;

// @ts-expect-error the trio identity catalogue requires every trio role
const missingTrioIdentity: { readonly [R in BuiltinTeamRole<'trio'>]: RoleIdentity } = {
  coordinator: TRIO_ROLE_IDENTITY.coordinator,
};
void missingTrioIdentity;

// @ts-expect-error the solo identity catalogue requires every solo role
const missingSoloIdentity: { readonly [R in BuiltinTeamRole<'solo'>]: RoleIdentity } = {
  solo: SOLO_ROLE_IDENTITY.solo,
};
void missingSoloIdentity;

const extraTrioIdentity = {
  ...TRIO_ROLE_IDENTITY,
  // @ts-expect-error planner is not a builtin trio role
  planner: TRIO_ROLE_IDENTITY.coordinator,
} satisfies { readonly [R in BuiltinTeamRole<'trio'>]: RoleIdentity };
void extraTrioIdentity;

// The real catalogues must assign to the exhaustive key sets, even if a catalogue later loses its own annotation.
const duoIdentityCatalogue: { readonly [R in BuiltinTeamRole<'duo'>]: RoleIdentity } =
  DUO_ROLE_IDENTITY;
void duoIdentityCatalogue;
const trioIdentityCatalogue: { readonly [R in BuiltinTeamRole<'trio'>]: RoleIdentity } =
  TRIO_ROLE_IDENTITY;
void trioIdentityCatalogue;
const soloIdentityCatalogue: { readonly [R in BuiltinTeamRole<'solo'>]: RoleIdentity } =
  SOLO_ROLE_IDENTITY;
void soloIdentityCatalogue;

// @ts-expect-error builtin duo contract catalogs require every duo role
const missingDuoContract: BuiltinTeamHandoffCatalog<'duo'> = {
  planner: DUO_ROLE_HANDOFF_CATALOG.planner,
  builder: DUO_ROLE_HANDOFF_CATALOG.builder,
  researcher: DUO_ROLE_HANDOFF_CATALOG.researcher,
  reviewer: DUO_ROLE_HANDOFF_CATALOG.reviewer,
  'game-asset-designer': DUO_ROLE_HANDOFF_CATALOG['game-asset-designer'],
  verifier: DUO_ROLE_HANDOFF_CATALOG.verifier,
  triage: DUO_ROLE_HANDOFF_CATALOG.triage,
  'uiux-engineer': DUO_ROLE_HANDOFF_CATALOG['uiux-engineer'],
};
void missingDuoContract;

// @ts-expect-error builtin trio contract catalogs require every trio role
const missingTrioContract: BuiltinTeamHandoffCatalog<'trio'> = {
  coordinator: TRIO_ROLE_HANDOFF_CATALOG.coordinator,
  builder: TRIO_ROLE_HANDOFF_CATALOG.builder,
  architect: TRIO_ROLE_HANDOFF_CATALOG.architect,
  researcher: TRIO_ROLE_HANDOFF_CATALOG.researcher,
  reviewer: TRIO_ROLE_HANDOFF_CATALOG.reviewer,
  'game-asset-designer': TRIO_ROLE_HANDOFF_CATALOG['game-asset-designer'],
  verifier: TRIO_ROLE_HANDOFF_CATALOG.verifier,
  triage: TRIO_ROLE_HANDOFF_CATALOG.triage,
  'uiux-engineer': TRIO_ROLE_HANDOFF_CATALOG['uiux-engineer'],
};
void missingTrioContract;

const extraTrioContract = {
  ...TRIO_ROLE_HANDOFF_CATALOG,
  // @ts-expect-error planner is not a builtin trio member
  planner: TRIO_ROLE_HANDOFF_CATALOG.coordinator,
} satisfies BuiltinTeamHandoffCatalog<'trio'>;
void extraTrioContract;

const extraDuoContract = {
  ...DUO_ROLE_HANDOFF_CATALOG,
  // @ts-expect-error tester is not a builtin duo member
  tester: DUO_ROLE_HANDOFF_CATALOG.planner,
} satisfies BuiltinTeamHandoffCatalog<'duo'>;
void extraDuoContract;

const mismatchedOwner: BuiltinTeamHandoffCatalog<'duo'> = {
  ...DUO_ROLE_HANDOFF_CATALOG,
  // @ts-expect-error the architect key requires an architect-owned contract
  architect: DUO_ROLE_HANDOFF_CATALOG.triage,
};
void mismatchedOwner;

const soloAsDuo: BuiltinTeamRoleHandoffContract<'duo', 'planner'> = {
  // @ts-expect-error solo is not a duo owner
  role: 'solo',
  receivesFrom: ['user'],
  returnsTo: ['user'],
  outboundTemplates: { user: () => 'handoff' },
};
void soloAsDuo;

const soloAsDuoTarget: BuiltinTeamRoleHandoffContract<'duo', 'planner'> = {
  role: 'planner',
  // @ts-expect-error solo is not a valid duo target
  receivesFrom: ['solo'],
  returnsTo: ['user'],
  outboundTemplates: { user: () => 'handoff' },
};
void soloAsDuoTarget;

const unknownBuiltinTarget: BuiltinTeamRoleHandoffContract<'duo', 'planner'> = {
  role: 'planner',
  // @ts-expect-error designer is not a duo role or user
  receivesFrom: ['designer'],
  returnsTo: ['user'],
  outboundTemplates: { user: () => 'handoff' },
};
void unknownBuiltinTarget;

const retiredBuiltinTarget: BuiltinTeamRoleHandoffContract<'duo', 'planner'> = {
  role: 'planner',
  receivesFrom: ['user'],
  returnsTo: ['user'],
  // @ts-expect-error enhancer is retired and cannot be a builtin target
  outboundTemplates: { enhancer: () => 'handoff' },
};
void retiredBuiltinTarget;

const customReviewer: RoleHandoffContract<'reviewer', 'tester' | 'user'> = {
  role: 'reviewer',
  receivesFrom: ['user'],
  returnsTo: ['tester', 'user'],
  outboundTemplates: { tester: () => 'review', user: () => 'done' },
};
const customTester: RoleHandoffContract<'tester', 'reviewer' | 'user'> = {
  role: 'tester',
  receivesFrom: ['reviewer'],
  returnsTo: ['reviewer', 'user'],
  outboundTemplates: { reviewer: () => 'result', user: () => 'done' },
};
const knownBuiltin: BuiltinAgentRole = 'triage';
void [customReviewer, customTester, knownBuiltin, SOLO_ROLE_HANDOFF_CATALOG];
