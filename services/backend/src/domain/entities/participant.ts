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

/**
 * Returns true if the participant is in an active (non-exited) state.
 * Use this to filter participant lists for routing, handoff, and queue promotion.
 */
export function isActiveParticipant(participant: { lastSeenAction?: string | null }): boolean {
  return participant.lastSeenAction !== PARTICIPANT_EXITED_ACTION;
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
