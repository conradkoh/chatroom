/**
 * Shared types for agent presence and team readiness.
 * Single source of truth — imported by AgentPanel, ChatroomDashboard, etc.
 */

// ─── Participant Info (flat — presence-based, no FSM status) ──────────────────

/**
 * Participant info from the backend readiness query.
 * Presence is derived from lastSeenAt; action context from lastSeenAction.
 *
 * Note: AgentPanel derives status from lastStatus (denormalized from event stream).
 * lastSeenAction is still used by ChatroomListingContext, WorkQueue, and ChatroomDashboard.
 */
export interface ParticipantInfo {
  role: string;
  agentType?: 'remote' | 'custom';
  lastSeenAt?: number | null;
  lastSeenAction?: string | null;
  lastStatus?: string | null;
  lastDesiredState?: string | null;
}

/**
 * Team lifecycle data from the backend.
 * Raw state only — all status derivation (online/offline, ready, etc.) is done on the frontend.
 */
export interface TeamLifecycle {
  teamId: string;
  teamName: string;
  expectedRoles: string[];
  participants: ParticipantInfo[];
  /** Whether the chatroom has been used (has user messages) */
  hasHistory: boolean;
}


