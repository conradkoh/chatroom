/**
 * Shared participant state constants.
 *
 * Provides typed arrays of participant status values grouped by category.
 * These stay in sync with the schema union via `satisfies` constraints.
 *
 * To add a new dead state:
 * 1. Add the literal to the schema's `status` union in `convex/schema.ts`
 * 2. Add it to `DeadState` type below
 * 3. Add it to `DEAD_STATES` array
 */

/**
 * Participant statuses that indicate the agent is non-functional
 * (crashed, failed restart, or in the process of restarting).
 *
 * Used to determine whether to create a minimal participant record
 * when the participant doesn't exist yet (e.g. daemon reporting crash status).
 */
export type DeadState = 'dead' | 'dead_failed_revive' | 'restarting';

/**
 * All participant statuses considered "dead" — the agent is non-functional.
 * Typed as `readonly DeadState[]` and validated with `satisfies` to ensure
 * every `DeadState` literal is included.
 */
export const DEAD_STATES: readonly DeadState[] = [
  'dead',
  'dead_failed_revive',
  'restarting',
] as const satisfies readonly DeadState[];
