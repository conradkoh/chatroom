/**
 * Key: `duo:planner->reviewer@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo planner → reviewer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToReviewerHandoffTemplate } from '../../reviewer-handoff-templates';

export function getPlannerReviewerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToReviewerHandoffTemplate(query);
}
