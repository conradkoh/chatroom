/**
 * Key: `duo:verifier->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo verifier → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getVerifierToEntryPointHandoffTemplate } from '../../verifier-handoff-templates';

export function getVerifierPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getVerifierToEntryPointHandoffTemplate(query);
}
