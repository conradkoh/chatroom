/**
 * Key: `duo:planner->researcher@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo planner → researcher code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToResearcherHandoffTemplate } from '../../researcher-handoff-templates';

export function getPlannerResearcherCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToResearcherHandoffTemplate(query);
}
