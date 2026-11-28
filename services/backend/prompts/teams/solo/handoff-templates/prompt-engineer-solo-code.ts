/**
 * Key: `solo:prompt-engineer->solo@code` (bucket `code`).
 * Solo prompt-engineer → solo code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getPromptEngineerToEntryPointHandoffTemplate } from '../../prompt-engineer-handoff-templates';

export function getPromptEngineerSoloCodeTemplate(query: HandoffTemplateQuery): string {
  return getPromptEngineerToEntryPointHandoffTemplate(query);
}
