/**
 * Key: `solo:uiux-engineer->solo@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Solo uiux-engineer → solo code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export function getUiuxEngineerSoloCodeTemplate(query: HandoffTemplateQuery): string {
  return getUiuxEngineerToEntryPointHandoffTemplate(query);
}
