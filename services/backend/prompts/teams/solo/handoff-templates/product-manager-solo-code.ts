/**
 * Key: `solo:product-manager->solo@code` (bucket `code`).
 * Solo product manager → solo code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getProductManagerToEntryPointHandoffTemplate } from '../../product-manager-handoff-templates';

export function getProductManagerSoloCodeTemplate(query: HandoffTemplateQuery): string {
  return getProductManagerToEntryPointHandoffTemplate(query);
}
