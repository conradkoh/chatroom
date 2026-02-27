/**
 * Team configurations exports
 */

// Pair team
export { pairTeamConfig, getPairWorkflow } from './pair/index';
export {
  getBuilderGuidance as getPairBuilderGuidance,
  getReviewerGuidance as getPairReviewerGuidance,
} from './pair/index';

// Squad team
export { squadTeamConfig } from './squad/index';
export {
  getPlannerGuidance as getSquadPlannerGuidance,
  getBuilderGuidance as getSquadBuilderGuidance,
  getReviewerGuidance as getSquadReviewerGuidance,
} from './squad/index';

// Duo team
export { duoTeamConfig } from './duo/index';
export {
  getPlannerGuidance as getDuoPlannerGuidance,
  getBuilderGuidance as getDuoBuilderGuidance,
} from './duo/index';
