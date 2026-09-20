/**
 * Solo handoff template resolver — compatibility facade over role-owned contracts.
 *
 * The solo catalog declares the solo role and its user handoff contract.
 */
// fallow-ignore-file unused-export unused-type

import { soloArchitectHandoffContract } from './architect';
import { soloHandoffContract } from './solo';
import { soloUiuxEngineerHandoffContract } from './uiux-engineer';
import type {
  HandoffTemplateQuery,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';
import { validateRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as SoloHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned solo catalog (solo and optional specialists). */
export const SOLO_ROLE_HANDOFF_CONTRACTS: readonly RoleHandoffContract[] = [
  soloHandoffContract,
  soloArchitectHandoffContract,
  soloUiuxEngineerHandoffContract,
];

/** Validated once at module load so broken catalogs fail fast in tests/startup. */
export const validatedSoloRoleHandoffContracts: readonly RoleHandoffContract[] = (() => {
  validateRoleHandoffContracts(SOLO_ROLE_HANDOFF_CONTRACTS);
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
