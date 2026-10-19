/**
 * Key: `solo:architect->solo@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Solo architect → solo code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export function getArchitectSoloCodeTemplate(query: HandoffTemplateQuery): string {
  return getArchitectToEntryPointHandoffTemplate(query);
}
