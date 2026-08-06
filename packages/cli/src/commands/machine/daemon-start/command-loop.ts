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
} from '../../../daemon/entry/command-dispatch.js';
