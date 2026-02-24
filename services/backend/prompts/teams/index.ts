/**
 * Team configurations exports
 */

// Pair team
export { pairTeamConfig, getPairWorkflow } from './pair/index.js';
export {
  getBuilderGuidance as getPairBuilderGuidance,
  getReviewerGuidance as getPairReviewerGuidance,
} from './pair/index.js';

// Squad team
export { squadTeamConfig } from './squad/index.js';
export {
  getPlannerGuidance as getSquadPlannerGuidance,
  getBuilderGuidance as getSquadBuilderGuidance,
  getReviewerGuidance as getSquadReviewerGuidance,
} from './squad/index.js';

// Duo team
export { duoTeamConfig } from './duo/index.js';
export {
  getPlannerGuidance as getDuoPlannerGuidance,
  getBuilderGuidance as getDuoBuilderGuidance,
} from './duo/index.js';
