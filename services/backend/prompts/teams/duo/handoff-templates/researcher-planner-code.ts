/**
 * Key: `duo:researcher->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo researcher → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getResearcherToEntryPointHandoffTemplate } from '../../researcher-handoff-templates';

export function getResearcherPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getResearcherToEntryPointHandoffTemplate(query);
}
