/**
 * Key: `duo:planner->triage@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo planner → triage code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';

export function getPlannerTriageCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToTriageHandoffTemplate(query);
}
