/**
 * Key: `solo:solo->uiux-engineer@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Solo solo → uiux-engineer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export function getSoloUiuxEngineerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToUiuxEngineerHandoffTemplate(query);
}
