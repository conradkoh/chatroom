/**
 * Key: `trio:coordinator->triage@code` (bucket `code`).
 * Trio coordinator → triage code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';

export function getCoordinatorTriageCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToTriageHandoffTemplate(query);
}
