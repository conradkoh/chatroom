/**
 * Key: `solo:solo->architect@code` (bucket `code`).
 * Solo solo → architect code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';

export function getSoloArchitectCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToArchitectHandoffTemplate(query);
}
