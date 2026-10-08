/**
 * Duo handoff template resolver — compatibility facade over role-owned contracts.
 *
 * Pair-keyed registries are gone; each role module owns its outbound targets.
 * This index selects the role contract by fromRole and dispatches to the
 * target getter, preserving the historical pair resolver behaviour for callers.
 */
// fallow-ignore-file unused-export unused-type

import { duoArchitectHandoffContract } from './architect';
import { duoBuilderHandoffContract } from './builder';
import { duoPlannerHandoffContract } from './planner';
import { duoResearcherHandoffContract } from './researcher';
import { duoTriageHandoffContract } from './triage';
import { duoUiuxEngineerHandoffContract } from './uiux-engineer';
import { validateBuiltinTeamRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';
import type {
  BuiltinTeamHandoffCatalog,
  HandoffTemplateQuery,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as DuoHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned duo catalog, including ephemeral architect, researcher, triage, and UI/UX roles. */
export const DUO_ROLE_HANDOFF_CATALOG = {
  planner: duoPlannerHandoffContract,
  builder: duoBuilderHandoffContract,
  architect: duoArchitectHandoffContract,
  researcher: duoResearcherHandoffContract,
  'uiux-engineer': duoUiuxEngineerHandoffContract,
  triage: duoTriageHandoffContract,
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

export function getDuoHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const fromRole = query.fromRole.toLowerCase();
  const toRole = query.toRole.toLowerCase();
  const contract = validatedDuoRoleHandoffContracts.find(
    (candidate) => candidate.role.toLowerCase() === fromRole
  );
  const getter = contract?.outboundTemplates[toRole];
  return getter?.(query) ?? null;
}
