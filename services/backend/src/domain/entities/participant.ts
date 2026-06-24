/**
 * Domain Model: Participant
 *
 * Constants and helpers for participant record management.
 * Participant records track real-time agent connection state.
 */

/**
 * The `lastSeenAction` value set when an agent exits (crash or intentional).
 * Participant records are patched with this value instead of being deleted,
 * preserving `lastSeenAt` history for the UI.
 *
 * Consumers that list "active" participants must filter out records
 * with this action value.
 */
export const PARTICIPANT_EXITED_ACTION = 'exited';

/** Participant heartbeat action when a native harness session is ready for task injection. */
export const NATIVE_WAITING_ACTION = 'native:waiting';

/** Participant heartbeat action when a task has been injected into a native harness session. */
export const NATIVE_TASK_INJECTED_ACTION = 'native:task-injected';
export const GET_NEXT_TASK_STOPPED_ACTION = 'get-next-task:stopped';

/**
 * Returns true if the participant is in an active (non-exited) state.
 * Use this to filter participant lists for routing, handoff, and queue promotion.
 */
export function isActiveParticipant(participant: { lastSeenAction?: string | null }): boolean {
  return participant.lastSeenAction !== PARTICIPANT_EXITED_ACTION;
}

/** Statuses where the agent is already online or in-flight — skip restart. */
const ONLINE_OR_STARTING_STATUSES = new Set([
  'agent.waiting',
  'agent.requestStart',
  'agent.started',
  'task.acknowledged',
  'task.inProgress',
  'task.completed',
  'agent.requestStop',
]);

function isOnlineOrStartingStatus(status: string | null): boolean {
  return status != null && ONLINE_OR_STARTING_STATUSES.has(status);
}

/**
 * Returns true if a remote agent with desiredState=running should be restarted
 * because it is offline (crashed/exited/never started) when the user sends a message.
 */
export function isOfflineForUserMessageRestart(participant: {
  lastStatus?: string | null;
  lastDesiredState?: string | null;
  lastSeenAction?: string | null;
  isAlive?: boolean;
}): boolean {
  // Intentional stop — user chose to stop; do not auto-restart
  if (participant.lastDesiredState === 'stopped') return false;
  if (participant.isAlive === true) return false;
  if (participant.isAlive === false) return true;
  if (participant.lastSeenAction === PARTICIPANT_EXITED_ACTION) return true;
  return !isOnlineOrStartingStatus(participant.lastStatus ?? null);
}

/**
 * Canonical participant-presence row exposed to clients.
 *
 * This is the single source of truth for the presence shape. Every query that
 * surfaces participant presence (`listParticipantPresence`, `getPresenceForChatroom`,
 * …) MUST build rows via {@link toParticipantPresence} so the contract cannot drift
 * field-by-field across queries — and so the frontend can mirror exactly one shape.
 *
 * Note the optional DB columns are normalized to a REQUIRED `… | null` value here
 * (not dropped, not defaulted to a plausible-but-wrong value): "not yet known" is
 * represented explicitly as `null`, never silently coerced to a real-looking default.
 */
export interface ParticipantPresence {
  chatroomId: string;
  role: string;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
  lastStatus: string | null;
  lastDesiredState: string | null;
}

/** Source fields a participant record contributes to its presence row. */
export interface ParticipantPresenceSource {
  role: string;
  lastSeenAt?: number | null;
  lastSeenAction?: string | null;
  lastStatus?: string | null;
  lastDesiredState?: string | null;
}

/**
 * Maps a participant record into the canonical {@link ParticipantPresence} row.
 * Optional columns become an explicit `null` rather than `undefined` or a default.
 */
export function toParticipantPresence(
  chatroomId: string,
  participant: ParticipantPresenceSource
): ParticipantPresence {
  return {
    chatroomId,
    role: participant.role,
    lastSeenAt: participant.lastSeenAt ?? null,
    lastSeenAction: participant.lastSeenAction ?? null,
    lastStatus: participant.lastStatus ?? null,
    lastDesiredState: participant.lastDesiredState ?? null,
  };
}
