/**
 * Key: `trio:product-manager->coordinator@code` (bucket `code`).
 * Trio product manager → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getProductManagerToEntryPointHandoffTemplate } from '../../product-manager-handoff-templates';

export function getProductManagerCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getProductManagerToEntryPointHandoffTemplate(query);
}
