/**
 * Key: `duo:builder->planner@code` (bucket `code`).
 * Builder → planner work-complete/blocked handback. Body only: the pair resolver
 * prepends the recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getBuilderHandbackTemplate } from '../../builder-handback-handoff-templates';

/** Code-bucket getter for the duo `builder` → `planner` handoff. */
export function getBuilderPlannerCodeTemplate(query: HandoffTemplateQuery): string {
  return getBuilderHandbackTemplate(query);
}
