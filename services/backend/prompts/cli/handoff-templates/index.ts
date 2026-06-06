/**
 * Barrel + resolver for role-specific handoff templates.
 *
 * Handoff templates provide good structure for how a role hands work off to
 * the next role. They replace the previous rule that forced all delegation
 * through structured workflows — structured workflows are now an opt-in tool
 * the user (or planner) can request via the `workflow` skill.
 *
 * The planner → user report template is delivered eagerly with the user
 * message so it can shape the planner's goals from the start.
 */

import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';

export { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
export { getPlannerToUserReportTemplate } from './planner-to-user';

/** Identifies a directed handoff between two roles. */
export interface HandoffTemplateQuery {
  fromRole: string;
  toRole: string;
}

/**
 * Resolves the handoff template for a given (fromRole → toRole) pair.
 *
 * Returns `null` when no specialized template exists for the pair — callers
 * fall back to the generic free-form handoff message in that case.
 */
export function getHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const from = query.fromRole.toLowerCase();
  const to = query.toRole.toLowerCase();

  if (from === 'planner' && to === 'builder') {
    return getPlannerToBuilderHandoffTemplate();
  }
  if (from === 'planner' && to === 'user') {
    return getPlannerToUserReportTemplate();
  }
  return null;
}
