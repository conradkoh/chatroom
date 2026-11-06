/**
 * Key: `duo:architect->planner@code` (bucket `code`).
 * Duo architect → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export function getArchitectPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getArchitectToEntryPointHandoffTemplate(query);
}
