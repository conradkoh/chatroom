/**
 * Squad team role prompts
 */

export { getPlannerGuidance } from './planner.js';
export { getBuilderGuidance } from './builder.js';
export { getReviewerGuidance } from './reviewer.js';

// SelectorContext-based adapters (Phase 1.3)
export {
  getSquadRoleGuidanceFromContext,
  getSquadBuilderGuidanceFromContext,
  getSquadReviewerGuidanceFromContext,
  getSquadPlannerGuidanceFromContext,
} from './fromContext.js';
