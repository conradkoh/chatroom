/**
 * Key: `trio:coordinator->prompt-engineer@code` (bucket `code`).
 * Trio coordinator → prompt-engineer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToPromptEngineerHandoffTemplate } from '../../prompt-engineer-handoff-templates';

export function getCoordinatorPromptEngineerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToPromptEngineerHandoffTemplate(query);
}
