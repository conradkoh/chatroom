/**
 * Key: `trio:triage->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio triage → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export function getTriageCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getTriageToEntryPointHandoffTemplate(query);
}
