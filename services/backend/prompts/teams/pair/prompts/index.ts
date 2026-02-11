/**
 * Pair team role prompts
 */

export { getBuilderGuidance } from './builder.js';
export { getReviewerGuidance } from './reviewer.js';

// SelectorContext-based adapters (Phase 1.3)
export {
  getPairRoleGuidanceFromContext,
  getPairBuilderGuidanceFromContext,
  getPairReviewerGuidanceFromContext,
} from './fromContext.js';
