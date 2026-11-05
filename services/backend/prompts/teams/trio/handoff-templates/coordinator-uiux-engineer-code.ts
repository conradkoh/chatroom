/**
 * Key: `trio:coordinator->uiux-engineer@code` (bucket `code`).
 * Trio coordinator → UI/UX engineer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export function getCoordinatorUiuxEngineerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToUiuxEngineerHandoffTemplate(query);
}
