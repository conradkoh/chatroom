/**
 * Key: `duo:planner->builder@code` (bucket `code`).
 * Planner → builder delegation brief. Body only: the pair resolver prepends the
 * recipient callout and the title line. Fields that do not apply may be omitted.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getBuilderDelegationBriefTemplate } from '../../builder-delegation-handoff-templates';

/** Code-bucket getter for the duo `planner` → `builder` handoff. */
export function getPlannerBuilderCodeTemplate(_query: HandoffTemplateQuery): string {
  return getBuilderDelegationBriefTemplate({ delegatorRole: 'planner', gatesOwner: 'self' });
}
