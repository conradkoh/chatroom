/**
 * Solo handoff template resolver — compatibility facade over role-owned contracts.
 *
 * The solo catalog declares the permanent entry point and its ephemeral
 * advisory roles, all with role-owned handoff capabilities.
 */
// fallow-ignore-file unused-export unused-type

import { soloArchitectHandoffContract } from './architect';
import { soloHandoffContract } from './solo';
import { soloTriageHandoffContract } from './triage';
import { soloUiuxEngineerHandoffContract } from './uiux-engineer';
import type {
  BuiltinTeamHandoffCatalog,
  HandoffTemplateQuery,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';
import { validateBuiltinTeamRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as SoloHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned solo catalog, including ephemeral architect, triage, and UI/UX roles. */
export const SOLO_ROLE_HANDOFF_CATALOG = {
  solo: soloHandoffContract,
  architect: soloArchitectHandoffContract,
  'uiux-engineer': soloUiuxEngineerHandoffContract,
  triage: soloTriageHandoffContract,
} satisfies BuiltinTeamHandoffCatalog<'solo'>;

export const SOLO_ROLE_HANDOFF_CONTRACTS: readonly RoleHandoffContract[] =
  Object.values(SOLO_ROLE_HANDOFF_CATALOG);

/** Validated once at module load so broken catalogs fail fast in tests/startup. */
export const validatedSoloRoleHandoffContracts: readonly RoleHandoffContract[] = (() => {
  validateBuiltinTeamRoleHandoffContracts('solo', SOLO_ROLE_HANDOFF_CONTRACTS);
  return SOLO_ROLE_HANDOFF_CONTRACTS;
})();

export function listSoloRoleHandoffContracts(): readonly RoleHandoffContract[] {
  return validatedSoloRoleHandoffContracts;
}

export function getSoloHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const fromRole = query.fromRole.toLowerCase();
  const toRole = query.toRole.toLowerCase();
  const contract = validatedSoloRoleHandoffContracts.find(
    (candidate) => candidate.role.toLowerCase() === fromRole
  );
  const getter = contract?.outboundTemplates[toRole];
  return getter?.(query) ?? null;
}
