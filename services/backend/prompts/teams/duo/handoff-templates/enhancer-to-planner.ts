/** Handoff template: Duo enhancer → planner (independent planning input). */

import { getEnhancerToEntryPointHandoffTemplate } from '../../../enhancer/handoff-templates.js';

/** Returns the structured planning input the enhancer sends to the planner. */
export function getEnhancerToPlannerHandoffTemplate(): string {
  return getEnhancerToEntryPointHandoffTemplate('planner');
}
