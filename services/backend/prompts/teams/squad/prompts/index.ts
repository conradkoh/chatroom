/**
 * Squad team role prompts
 */

export { getPlannerGuidance } from './planner';
export { getBuilderGuidance } from './builder';
export { getReviewerGuidance } from './reviewer';

// SelectorContext-based adapters (Phase 1.3)
export {
  getSquadRoleGuidanceFromContext,
  getSquadBuilderGuidanceFromContext,
  getSquadReviewerGuidanceFromContext,
  getSquadPlannerGuidanceFromContext,
} from './fromContext';
