/**
 * Key: `trio:researcher->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio researcher → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getResearcherToEntryPointHandoffTemplate } from '../../researcher-handoff-templates';

export function getResearcherCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getResearcherToEntryPointHandoffTemplate(query);
}
