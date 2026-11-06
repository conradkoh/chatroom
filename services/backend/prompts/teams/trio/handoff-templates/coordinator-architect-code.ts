/**
 * Key: `trio:coordinator->architect@code` (bucket `code`).
 * Trio coordinator → architect code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';

export function getCoordinatorArchitectCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToArchitectHandoffTemplate(query);
}
