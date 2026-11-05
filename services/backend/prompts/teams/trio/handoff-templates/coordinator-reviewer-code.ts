/**
 * Key: `trio:coordinator->reviewer@code` (bucket `code`).
 * Trio coordinator → reviewer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToReviewerHandoffTemplate } from '../../reviewer-handoff-templates';

export function getCoordinatorReviewerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToReviewerHandoffTemplate(query);
}
