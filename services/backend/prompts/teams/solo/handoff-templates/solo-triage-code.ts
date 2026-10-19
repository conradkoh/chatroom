/**
 * Key: `solo:solo->triage@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Solo solo → triage code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';

export function getSoloTriageCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToTriageHandoffTemplate(query);
}
