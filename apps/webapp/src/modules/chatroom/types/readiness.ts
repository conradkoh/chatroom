/**
 * Shared types for agent status and team readiness.
 * Single source of truth — imported by AgentPanel, ChatroomDashboard, TeamStatus, etc.
 */

// ─── Agent Status Types (per agent type) ─────────────────────────────────────

/**
 * Display statuses for remote (daemon-managed) agents.
 * Remote agents support the full lifecycle including daemon-controlled transitions.
 */
export type RemoteAgentStatus =
  | 'offline'
  | 'starting'
  | 'ready'
  | 'working'
  | 'stopping'
  | 'restarting'
  | 'dead'
  | 'dead_failed_revive';

/**
 * Display statuses for custom (user-managed) agents.
 * Custom agents lack daemon control, so starting/stopping/restarting/dead_failed_revive
 * are not valid — the platform cannot observe or control these transitions.
 */
export type CustomAgentStatus = 'offline' | 'ready' | 'working' | 'dead';

/** Union of all possible display statuses across agent types. */
export type AgentStatus = RemoteAgentStatus | CustomAgentStatus;

/**
 * Raw participant status values from the backend schema.
 * These are the actual `status` field values on `chatroom_participants`.
 */
export type ParticipantStatus =
  | 'active'
  | 'waiting'
  | 'offline'
  | 'dead'
  | 'dead_failed_revive'
  | 'restarting'
  | 'idle'; // deprecated, kept for backward compat

// ─── Participant Info (discriminated union by agent type) ─────────────────────

interface ParticipantInfoBase {
  role: string;
  status: ParticipantStatus;
  statusReason: string;
  readyUntil?: number;
  isExpired: boolean;
  desiredStatus?: 'running' | 'stopped';
  hasPendingCommand?: boolean;
}

export interface RemoteParticipantInfo extends ParticipantInfoBase {
  agentType: 'remote';
  displayStatus: RemoteAgentStatus;
}

export interface CustomParticipantInfo extends ParticipantInfoBase {
  agentType: 'custom';
  displayStatus: CustomAgentStatus;
}

export interface UnknownParticipantInfo extends ParticipantInfoBase {
  agentType: undefined;
  displayStatus: AgentStatus;
}

/** Participant info from the backend readiness query — discriminated by agent type */
export type ParticipantInfo =
  | RemoteParticipantInfo
  | CustomParticipantInfo
  | UnknownParticipantInfo;

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
