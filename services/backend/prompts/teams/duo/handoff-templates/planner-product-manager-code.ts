/**
 * Key: `duo:planner->product-manager@code` (bucket `code`).
 * Duo planner → product manager code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToProductManagerHandoffTemplate } from '../../product-manager-handoff-templates';

export function getPlannerProductManagerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToProductManagerHandoffTemplate(query);
}
