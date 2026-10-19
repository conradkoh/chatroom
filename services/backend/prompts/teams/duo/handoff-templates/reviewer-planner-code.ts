/**
 * Key: `duo:reviewer->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo reviewer → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getReviewerToEntryPointHandoffTemplate } from '../../reviewer-handoff-templates';

export function getReviewerPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getReviewerToEntryPointHandoffTemplate(query);
}
