/**
 * Key: `duo:uiux-engineer->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo uiux-engineer → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export function getUiuxEngineerPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getUiuxEngineerToEntryPointHandoffTemplate(query);
}
