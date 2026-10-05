// fallow-ignore-file unused-file
import type { BuiltinAgentRole } from '@workspace/shared/domain/agent-role';

import type {
  BuiltinTeamHandoffCatalog,
  BuiltinTeamRoleHandoffContract,
  RoleHandoffContract,
} from './contracts';
import { DUO_ROLE_HANDOFF_CATALOG } from '../../teams/duo/handoff-templates';
import { SOLO_ROLE_HANDOFF_CATALOG } from '../../teams/solo/handoff-templates';
import { BUILTIN_ROLE_TEMPLATES } from '../../templates';
import type { BuiltinRoleTemplateCatalog } from '../../templates';

// @ts-expect-error builtin prompt catalogs require the omitted architect role
const missingPrompt: BuiltinRoleTemplateCatalog = {
  planner: BUILTIN_ROLE_TEMPLATES.planner,
  builder: BUILTIN_ROLE_TEMPLATES.builder,
  solo: BUILTIN_ROLE_TEMPLATES.solo,
  triage: BUILTIN_ROLE_TEMPLATES.triage,
  'uiux-engineer': BUILTIN_ROLE_TEMPLATES['uiux-engineer'],
};
void missingPrompt;

const wrongPrompt: BuiltinRoleTemplateCatalog = {
  ...BUILTIN_ROLE_TEMPLATES,
  // @ts-expect-error the key and role identity must match
  architect: { ...BUILTIN_ROLE_TEMPLATES.architect, role: 'triage' },
};
void wrongPrompt;

// @ts-expect-error builtin duo contract catalogs require every duo role
const missingDuoContract: BuiltinTeamHandoffCatalog<'duo'> = {
  planner: DUO_ROLE_HANDOFF_CATALOG.planner,
  builder: DUO_ROLE_HANDOFF_CATALOG.builder,
  triage: DUO_ROLE_HANDOFF_CATALOG.triage,
  'uiux-engineer': DUO_ROLE_HANDOFF_CATALOG['uiux-engineer'],
};
void missingDuoContract;

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
  // @ts-expect-error reviewer is not a duo role or user
  receivesFrom: ['reviewer'],
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
