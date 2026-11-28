/**
 * Key: `duo:prompt-engineer->planner@code` (bucket `code`).
 * Duo prompt-engineer → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getPromptEngineerToEntryPointHandoffTemplate } from '../../prompt-engineer-handoff-templates';

export function getPromptEngineerPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getPromptEngineerToEntryPointHandoffTemplate(query);
}
