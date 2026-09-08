/**
 * Compatibility entrypoint for orphan process tracking.
 * New code should use the agent-process service boundary.
 */
export {
  clearTrackedPids,
  clearTrackedPidsEffect,
  forceKillAllTrackedProcessGroups,
  forceKillAllTrackedProcessGroupsEffect,
  getChildPidsFilePath,
  reapOrphanedProcessGroups,
  reapOrphanedProcessGroupsEffect,
  trackChildPid,
  untrackChildPid,
} from '../../services/service-interfaces.js';
