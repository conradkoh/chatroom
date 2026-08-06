/**
 * Legacy command-loop shim — dispatch and runtime moved to v2 entry (U14).
 */

export {
  dispatchCommandEventEffect,
  handleInboundCommandEvent,
  type DedupTracker,
  type CommandDispatchDeps,
  createDedupTracker,
  evictStaleDedupEntries,
} from '../../../v2/entry/command-dispatch.js';
