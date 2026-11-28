/**
 * Trio handoff template catalog — role-owned contracts.
 *
 * Each role module owns its outbound targets; this index collects and validates
 * the catalog. Pair resolution lives in `cli/handoff-templates`.
 */
// fallow-ignore-file unused-export unused-type

import { trioArchitectHandoffContract } from './architect';
import { trioBuilderHandoffContract } from './builder';
import { trioCoordinatorHandoffContract } from './coordinator';
import { trioGameAssetDesignerHandoffContract } from './game-asset-designer';
import { trioProductManagerHandoffContract } from './product-manager';
import { trioPromptEngineerHandoffContract } from './prompt-engineer';
import { trioResearcherHandoffContract } from './researcher';
import { trioReviewerHandoffContract } from './reviewer';
import { trioSpecifierHandoffContract } from './specifier';
import { trioTriageHandoffContract } from './triage';
import { trioUiuxEngineerHandoffContract } from './uiux-engineer';
import { trioVerifierHandoffContract } from './verifier';
import { validateBuiltinTeamRoleHandoffContracts } from '../../../cli/handoff-templates/contracts';
import type {
  BuiltinTeamHandoffCatalog,
  RoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export type { HandoffTemplateQuery as TrioHandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';

/** Role-owned trio catalog, including ephemeral architect, prompt engineer, product manager, researcher, triage, reviewer, UI/UX, game asset designer, and verifier roles. */
export const TRIO_ROLE_HANDOFF_CATALOG = {
  coordinator: trioCoordinatorHandoffContract,
  specifier: trioSpecifierHandoffContract,
  builder: trioBuilderHandoffContract,
  architect: trioArchitectHandoffContract,
  'prompt-engineer': trioPromptEngineerHandoffContract,
  'product-manager': trioProductManagerHandoffContract,
  researcher: trioResearcherHandoffContract,
  reviewer: trioReviewerHandoffContract,
  'uiux-engineer': trioUiuxEngineerHandoffContract,
  'game-asset-designer': trioGameAssetDesignerHandoffContract,
  triage: trioTriageHandoffContract,
  verifier: trioVerifierHandoffContract,
} satisfies BuiltinTeamHandoffCatalog<'trio'>;

export const TRIO_ROLE_HANDOFF_CONTRACTS: readonly RoleHandoffContract[] =
  Object.values(TRIO_ROLE_HANDOFF_CATALOG);

/** Validated once at module load so broken catalogs fail fast in tests/startup. */
export const validatedTrioRoleHandoffContracts: readonly RoleHandoffContract[] = (() => {
  validateBuiltinTeamRoleHandoffContracts('trio', TRIO_ROLE_HANDOFF_CONTRACTS);
  return TRIO_ROLE_HANDOFF_CONTRACTS;
})();

export function listTrioRoleHandoffContracts(): readonly RoleHandoffContract[] {
  return validatedTrioRoleHandoffContracts;
}
