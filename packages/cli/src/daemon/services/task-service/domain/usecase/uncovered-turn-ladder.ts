/**
 * Ladder for a completed agent turn that ends without a handoff covering the task
 * ("uncovered turn end"). Per (task, session) the ladder is: nudge once, then
 * restart the session once, then park. Parking is decided by the caller.
 *
 * Constraints:
 * - "session" is the caller-supplied sessionKey (process pid + harness session id).
 * - The nudge budget is per session key. A new session key re-arms the nudge.
 * - The restart budget is per task and is never reset by a new session key.
 * - This module holds no state. The caller stores the entry.
 */
// Temporary: the completed-turn ladder in feat(agent-work-manager) (slice 4) consumes this
// export. That commit removes this suppression.
// fallow-ignore-next-line unused-export
export const MAX_SESSION_RESTARTS_PER_TASK = 1;

const FRESH_ENTRY: UncoveredTurnLadderEntry = { sessionRestarts: 0 };

export interface UncoveredTurnLadderEntry {
  readonly nudgedSessionKey?: string | undefined;
  readonly sessionRestarts: number;
}

export type UncoveredTurnDecision =
  | { readonly action: 'nudge' }
  | { readonly action: 'restart-session' }
  | { readonly action: 'park' };

/**
 * nudge            iff nudgedSessionKey !== sessionKey and nudging is available
 * restart-session  otherwise, iff sessionRestarts < MAX_SESSION_RESTARTS_PER_TASK
 * park             otherwise
 */
export function decideUncoveredTurnEnd(
  entry: UncoveredTurnLadderEntry | undefined,
  sessionKey: string,
  opts: { readonly nudgeUnavailable?: boolean } = {}
): UncoveredTurnDecision {
  const current = entry ?? FRESH_ENTRY;
  if (isNudgeDue(current, sessionKey, opts)) return { action: 'nudge' };
  return current.sessionRestarts < MAX_SESSION_RESTARTS_PER_TASK
    ? { action: 'restart-session' }
    : { action: 'park' };
}

/** A nudge is due when nudging is available and this session has not been nudged yet. */
function isNudgeDue(
  entry: UncoveredTurnLadderEntry,
  sessionKey: string,
  opts: { readonly nudgeUnavailable?: boolean }
): boolean {
  return !opts.nudgeUnavailable && entry.nudgedSessionKey !== sessionKey;
}

/** Record that a nudge was actually sent in this session. Keeps the restart count. */
export function withNudgeSent(
  entry: UncoveredTurnLadderEntry | undefined,
  sessionKey: string
): UncoveredTurnLadderEntry {
  return { nudgedSessionKey: sessionKey, sessionRestarts: entry?.sessionRestarts ?? 0 };
}

/** Record that a session restart is being attempted. Increments the restart count and clears the nudge key. */
export function withSessionRestart(
  entry: UncoveredTurnLadderEntry | undefined
): UncoveredTurnLadderEntry {
  return { nudgedSessionKey: undefined, sessionRestarts: (entry?.sessionRestarts ?? 0) + 1 };
}
