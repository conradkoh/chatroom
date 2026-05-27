/**
 * Local Actions — public API.
 *
 * Re-exports the local action executor used by both the local HTTP API and
 * the daemon command loop for Convex-relayed actions.
 */

export { executeLocalAction } from './execute-local-action.js';
export type { LocalActionType, LocalActionResult } from './execute-local-action.js';
