/**
 * Daemon Types — shared type definitions for the daemon command module.
 */

import type {
  AgentStartReason,
  AgentStopReason,
} from '@workspace/backend/src/domain/entities/agent';

import type { DaemonDeps } from './deps.js';
import type { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { AgentHarness, MachineConfig } from '../../../infrastructure/machine/types.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
// ─── Session & Config Types ─────────────────────────────────────────────────

/**
 * Named type alias for the session ID passed to Convex mutations/queries.
 * The Convex SessionIdArg expects a specific branded type, but our sessionId
 * is a plain string from local storage. This alias documents intent and
 * avoids bare `any` in every function signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionId = any;

export type { MachineConfig, AgentHarness };

// Re-export from canonical source (services/backend/src/domain/entities/agent.ts)
export type StartAgentReason = AgentStartReason;
export type StopAgentReason = AgentStopReason;

// ─── Command Types ──────────────────────────────────────────────────────────

/**
 * Start an agent process in a chatroom.
 * Requires chatroomId, role, and agentHarness. Model and workingDir are optional.
 */
export interface StartAgentCommand {
  type: 'start-agent';
  /**
   * Mandatory reason for the start command.
   * Logged by the daemon to distinguish automatic restarts from user-initiated starts.
   */
  reason: StartAgentReason;
  payload: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    model?: string;
    workingDir?: string;
  };
}

/**
 * Stop a running agent process in a chatroom.
 * Requires chatroomId and role to identify the target agent.
 */
export interface StopAgentCommand {
  type: 'stop-agent';
  /**
   * Mandatory reason for the stop command.
   * Logged by the daemon to distinguish user-initiated stops from automatic deduplication.
   */
  reason: StopAgentReason;
  payload: {
    chatroomId: string;
    role: string;
  };
}

/**
 * Discriminated union of all machine commands.
 * The `type` field determines which payload shape is available,
 * enabling TypeScript to narrow types in switch/case branches.
 */
export type MachineCommand = StartAgentCommand | StopAgentCommand;

/** Result returned by individual command handlers. */
export interface CommandResult {
  result: string;
  failed: boolean;
}

// ─── Daemon Context ─────────────────────────────────────────────────────────

/** Convex client type used throughout the daemon. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConvexClient = any;

/** Shared context passed to all command handlers. */
export interface DaemonContext {
  client: ConvexClient;
  sessionId: SessionId;
  machineId: string;
  config: MachineConfig | null;
  deps: DaemonDeps;
  events: DaemonEventBus;
  agentServices: Map<string, RemoteAgentService>;
  /**
   * Whether observed-sync feature is enabled.
   * When true, daemon subscribes to observed chatrooms instead of periodic git/command sync.
   * Toggle requires daemon restart.
   */
  observedSyncEnabled?: boolean;
  /**
   * Tracks the last git state pushed for each workspace (keyed by `machineId::workingDir`).
   * Value is a hash of the git state (branch + isDirty + diffStat) used for change detection.
   * Only push to backend when this hash changes.
   */
  lastPushedGitState: Map<string, string>;
  /**
   * Tracks the last available-models snapshot pushed to the backend.
   * Map key is the harness name (e.g. `opencode`, `pi`); value is the list of
   * model IDs reported for that harness on the most recent successful push.
   *
   * Used by `refreshModels` to diff locally each tick — the daemon is the
   * source of truth for "what changed since last sync", so no backend query
   * is needed. The mutation is only invoked when the snapshot differs from
   * the freshly discovered set.
   *
   * `null` means no snapshot has been recorded yet (e.g. before the first
   * push); in that case `refreshModels` always pushes.
   */
  lastPushedModels: Record<string, string[]> | null;
  /**
   * Stops the local API HTTP server.
   * Populated after `startLocalApi()` returns successfully.
   * May be undefined if the local API failed to start (e.g. port conflict).
   */
  stopLocalApi?: () => Promise<void>;
}
