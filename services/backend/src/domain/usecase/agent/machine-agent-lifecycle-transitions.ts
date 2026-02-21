/**
 * Machine Agent Lifecycle — state machine transitions.
 *
 * Defines valid state transitions and provides validation logic
 * for the chatroom_machineAgentLifecycle table.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  'offline',
  'start_requested',
  'starting',
  'ready',
  'working',
  'stop_requested',
  'stopping',
  'dead',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

// ─── Transition Map ──────────────────────────────────────────────────────────

/**
 * Valid state transitions. A transition from state A to state B is allowed
 * only if B appears in VALID_TRANSITIONS[A].
 */
export const VALID_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  offline: ['start_requested', 'ready'], // 'ready' allows custom agents to self-register without a daemon
  start_requested: ['starting', 'offline'],
  starting: ['ready', 'offline'],
  ready: ['working', 'stop_requested', 'dead'],
  working: ['ready', 'stop_requested', 'dead'],
  stop_requested: ['stopping', 'offline'],
  stopping: ['offline'],
  dead: ['offline', 'ready'], // 'ready' allows a custom agent to re-register after heartbeat expiry
};

// ─── Validation ──────────────────────────────────────────────────────────────

export interface TransitionValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Check if transitioning from `current` to `target` is allowed.
 */
export function validateTransition(
  current: LifecycleState,
  target: LifecycleState
): TransitionValidation {
  if (current === target) {
    return { valid: false, reason: `Already in state '${current}'` };
  }

  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    return {
      valid: false,
      reason: `Cannot transition from '${current}' to '${target}'. Allowed: [${allowed.join(', ')}]`,
    };
  }

  return { valid: true };
}

// ─── Reconciliation Timeouts ─────────────────────────────────────────────────

/** How long an agent can be in a transitional/dead state before the cron forces it offline. */
export const RECONCILIATION_TIMEOUTS: Partial<Record<LifecycleState, number>> = {
  dead: 300_000, // 5 min
  stopping: 300_000, // 5 min
  starting: 300_000, // 5 min
  start_requested: 300_000, // 5 min
  stop_requested: 300_000, // 5 min
};
