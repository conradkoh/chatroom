/**
 * Key: `trio:game-asset-designer->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Trio game asset designer → coordinator code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getGameAssetDesignerToEntryPointHandoffTemplate } from '../../game-asset-designer-handoff-templates';

export function getGameAssetDesignerCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return getGameAssetDesignerToEntryPointHandoffTemplate(query);
}
