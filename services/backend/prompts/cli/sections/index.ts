/**
 * Barrel export for planner prompt section builders.
 *
 * Each section builder accepts an explicit team composition config
 * and returns a standalone prompt section string. Callers (team
 * prompt files) compose sections by passing their known team config —
 * no runtime derivation or conditionals inside the section builders.
 */

export { getCoreResponsibilitiesSection } from './core-responsibilities';
export { getDelegationGuidelinesSection } from './delegation-guidelines';
export { getHandoffRulesSection } from './handoff-rules';
export { getWhenWorkComesBackSection } from './when-work-comes-back';
export { getTeamAvailabilitySection } from './team-availability';
export {
  getWorkflowSection,
  getFullTeamWorkflow,
  getPlannerPlusBuilderWorkflow,
  getPlannerPlusReviewerWorkflow,
  getPlannerSoloWorkflow,
} from './workflow';
export type { TeamCompositionConfig } from './team-composition';
