/**
 * Key: `trio:coordinator->researcher@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio coordinator → researcher code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToResearcherHandoffTemplate } from '../../researcher-handoff-templates';

export function getCoordinatorResearcherCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToResearcherHandoffTemplate(query);
}
