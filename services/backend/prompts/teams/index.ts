/**
 * Team configurations exports
 */

// Duo team
export { duoTeamConfig } from './duo/index';
export {
  getPlannerGuidance as getDuoPlannerGuidance,
  getBuilderGuidance as getDuoBuilderGuidance,
} from './duo/index';

// Solo team
export { soloTeamConfig } from './solo/index';
export { getSoloGuidance as getSoloRoleGuidance } from './solo/index';
