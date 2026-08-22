/** Handoff template: Duo planner → enhancer (request-first advisory pass). */

import { getEntryPointToEnhancerHandoffTemplate } from '../../../enhancer/handoff-templates.js';

export function getPlannerToEnhancerHandoffTemplate(): string {
  return getEntryPointToEnhancerHandoffTemplate('planner');
}
