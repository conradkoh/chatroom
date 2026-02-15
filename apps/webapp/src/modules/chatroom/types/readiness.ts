/**
 * Shared types for agent status and team readiness.
 * Single source of truth — imported by AgentPanel, ChatroomDashboard, TeamStatus, etc.
 */

/**
 * Agent Status FSM states (Plan 026).
 * These match the `agentStatus` field on `chatroom_participants` in the backend schema.
 *
 * Dead states (no heartbeat):
 * - offline: Default initial state — never joined or explicitly stopped
 * - dead: Heartbeat stopped — process presumed crashed
 * - dead_failed_revive: All restart attempts exhausted — manual intervention required
 *
 * Alive states (with heartbeat):
 * - ready: Running wait-for-task, heartbeat active, waiting for work
 * - restarting: Daemon attempting to restart after crash
 * - working: Actively processing a task, heartbeat active
 */
export type AgentStatus =
  | 'offline'
  | 'dead'
  | 'dead_failed_revive'
  | 'ready'
  | 'restarting'
  | 'working';

/** Participant info from the backend readiness query — includes expiration data and FSM status */
export interface ParticipantInfo {
  role: string;
  status: string; // legacy field ('active' | 'waiting')
  agentStatus: AgentStatus; // FSM status (Plan 026)
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
