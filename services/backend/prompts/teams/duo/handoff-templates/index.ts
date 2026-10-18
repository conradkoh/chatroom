/**
 * Duo handoff template catalog — role-owned contracts.
 *
 * Each role module owns its outbound targets; this index collects and validates
 * the catalog. Pair resolution lives in `cli/handoff-templates`.
 */
// fallow-ignore-file unused-export unused-type

import { duoArchitectHandoffContract } from './architect';
import { duoBuilderHandoffContract } from './builder';
import { duoPlannerHandoffContract } from './planner';
import { duoResearcherHandoffContract } from './researcher';
import { duoTriageHandoffContract } from './triage';
import { duoUiuxEngineerHandoffContract } from './uiux-engineer';
import { duoVerifierHandoffContract } from './verifier';
import { validateBuiltinTeamRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';
import type {
  BuiltinTeamHandoffCatalog,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as DuoHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned duo catalog, including ephemeral architect, researcher, triage, UI/UX, and verifier roles. */
export const DUO_ROLE_HANDOFF_CATALOG = {
  planner: duoPlannerHandoffContract,
  builder: duoBuilderHandoffContract,
  architect: duoArchitectHandoffContract,
  researcher: duoResearcherHandoffContract,
  'uiux-engineer': duoUiuxEngineerHandoffContract,
  triage: duoTriageHandoffContract,
  verifier: duoVerifierHandoffContract,
} satisfies BuiltinTeamHandoffCatalog<'duo'>;

export const DUO_ROLE_HANDOFF_CONTRACTS: readonly RoleHandoffContract[] =
  Object.values(DUO_ROLE_HANDOFF_CATALOG);

/** Validated once at module load so broken catalogs fail fast in tests/startup. */
export const validatedDuoRoleHandoffContracts: readonly RoleHandoffContract[] = (() => {
  validateBuiltinTeamRoleHandoffContracts('duo', DUO_ROLE_HANDOFF_CONTRACTS);
  return DUO_ROLE_HANDOFF_CONTRACTS;
})();

export function listDuoRoleHandoffContracts(): readonly RoleHandoffContract[] {
  return validatedDuoRoleHandoffContracts;
}
