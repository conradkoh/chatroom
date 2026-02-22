/**
 * Shared types for agent presence and team readiness.
 * Single source of truth — imported by AgentPanel, ChatroomDashboard, TeamStatus, etc.
 */

// ─── Participant Info (flat — presence-based, no FSM status) ──────────────────

/**
 * Participant info from the backend readiness query.
 * Presence is derived from lastSeenAt; action context from lastSeenAction.
 */
export interface ParticipantInfo {
  role: string;
  agentType?: 'remote' | 'custom';
  lastSeenAt?: number | null;
  lastSeenAction?: string | null;
  isStuck?: boolean;
}

/** Team readiness data from the backend — single source of truth for agent panel state */
export interface TeamReadiness {
  isReady: boolean;
  expectedRoles: string[];
  missingRoles: string[];
  expiredRoles?: string[];
  participants?: ParticipantInfo[];
  /** Optional — only some consumers need these */
  teamName?: string;
  presentRoles?: string[];
  /** Whether the chatroom has been used (has user messages) */
  hasHistory?: boolean;
}
