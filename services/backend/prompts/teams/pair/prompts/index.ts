/**
 * Pair team role prompts
 */

export { getBuilderGuidance } from './builder';
export { getReviewerGuidance } from './reviewer';

// SelectorContext-based adapters (Phase 1.3)
export {
  getPairRoleGuidanceFromContext,
  getPairBuilderGuidanceFromContext,
  getPairReviewerGuidanceFromContext,
} from './fromContext';
