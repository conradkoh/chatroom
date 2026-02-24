/**
 * Duo team role prompts
 */

export { getPlannerGuidance } from './planner.js';
export { getBuilderGuidance } from './builder.js';

// SelectorContext-based adapters
export {
  getDuoRoleGuidanceFromContext,
  getDuoBuilderGuidanceFromContext,
  getDuoPlannerGuidanceFromContext,
} from './fromContext.js';
