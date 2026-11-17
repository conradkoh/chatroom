/**
 * Key: `duo:product-manager->planner@code` (bucket `code`).
 * Duo product manager → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getProductManagerToEntryPointHandoffTemplate } from '../../product-manager-handoff-templates';

export function getProductManagerPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getProductManagerToEntryPointHandoffTemplate(query);
}
