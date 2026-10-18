/**
 * Key: `duo:planner->architect@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo planner → architect code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';

export function getPlannerArchitectCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToArchitectHandoffTemplate(query);
}
