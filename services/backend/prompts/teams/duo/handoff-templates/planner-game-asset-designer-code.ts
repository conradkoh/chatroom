/**
 * Key: `duo:planner->game-asset-designer@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Duo planner → game asset designer code-bucket body. Delegates to the shared body getter; the chat file re-exports this.
 */
import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToGameAssetDesignerHandoffTemplate } from '../../game-asset-designer-handoff-templates';

export function getPlannerGameAssetDesignerCodeTemplate(query: HandoffTemplateQuery): string {
  return getEntryPointToGameAssetDesignerHandoffTemplate(query);
}
