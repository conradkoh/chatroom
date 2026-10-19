/**
 * Key: `duo:triage->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo triage → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export function getTriagePlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getTriageToEntryPointHandoffTemplate(query);
}
