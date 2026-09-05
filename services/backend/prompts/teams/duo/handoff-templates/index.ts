/**
 * Duo handoff template resolver — compatibility facade over role-owned contracts.
 *
 * Pair-keyed registries are gone; each role module owns its outbound targets.
 * This index selects the role contract by fromRole and dispatches to the
 * target getter, preserving the historical pair resolver behaviour for callers.
 */
// fallow-ignore-file unused-export unused-type

import { duoBuilderHandoffContract } from './builder';
import { duoEnhancerHandoffContract } from './enhancer';
import { duoPlannerHandoffContract } from './planner';
import { validateRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';
import type {
  HandoffTemplateQuery,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as DuoHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned duo catalog (planner, builder, enhancer). */
export const DUO_ROLE_HANDOFF_CONTRACTS: readonly RoleHandoffContract[] = [
  duoPlannerHandoffContract,
  duoBuilderHandoffContract,
  duoEnhancerHandoffContract,
];

/** Validated once at module load so broken catalogs fail fast in tests/startup. */
export const validatedDuoRoleHandoffContracts: readonly RoleHandoffContract[] = (() => {
  validateRoleHandoffContracts(DUO_ROLE_HANDOFF_CONTRACTS);
  return DUO_ROLE_HANDOFF_CONTRACTS;
})();

export function listDuoRoleHandoffContracts(): readonly RoleHandoffContract[] {
  return validatedDuoRoleHandoffContracts;
}

export function getDuoHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const fromRole = query.fromRole.toLowerCase();
  const toRole = query.toRole.toLowerCase();
  const contract = validatedDuoRoleHandoffContracts.find(
    (candidate) => candidate.role.toLowerCase() === fromRole
  );
  const getter = contract?.outboundTemplates[toRole];
  return getter?.(query) ?? null;
}
