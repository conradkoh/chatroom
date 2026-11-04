/**
 * Key: `trio:uiux-engineer->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio UI/UX engineer → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export function getUiuxEngineerCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getUiuxEngineerToEntryPointHandoffTemplate(query);
}
