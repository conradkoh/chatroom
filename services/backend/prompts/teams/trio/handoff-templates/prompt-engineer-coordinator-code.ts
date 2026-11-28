/**
 * Key: `trio:prompt-engineer->coordinator@code` (bucket `code`).
 * Trio prompt-engineer → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getPromptEngineerToEntryPointHandoffTemplate } from '../../prompt-engineer-handoff-templates';

export function getPromptEngineerCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getPromptEngineerToEntryPointHandoffTemplate(query);
}
