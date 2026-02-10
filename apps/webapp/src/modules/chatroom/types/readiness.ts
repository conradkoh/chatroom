/**
 * Shared types for agent status and team readiness.
 * Single source of truth — imported by AgentPanel, ChatroomDashboard, TeamStatus, etc.
 */

/** Agent status values matching the STATUS_CONFIG keys in AgentPanel */
export type AgentStatus = 'active' | 'waiting' | 'disconnected' | 'missing';

/** Participant info from the backend readiness query — includes expiration data */
export interface ParticipantInfo {
  role: string;
  status: AgentStatus;
  readyUntil?: number;
  isExpired: boolean;
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
