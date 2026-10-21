/**
 * Key: `duo:game-asset-designer->planner@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo game asset designer → planner code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getGameAssetDesignerToEntryPointHandoffTemplate } from '../../game-asset-designer-handoff-templates';

export function getGameAssetDesignerPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getGameAssetDesignerToEntryPointHandoffTemplate(query);
}
