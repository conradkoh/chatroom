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
