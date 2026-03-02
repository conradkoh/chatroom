/**
 * Daemon Types — shared type definitions for the daemon command module.
 */

import type { DaemonDeps } from './deps.js';
import type { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { Id } from '../../../api.js';
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

// ─── Command Reason Types ─────────────────────────────────────────────────────

/**
 * Human-readable reasons for dispatching a start-agent command.
 *
 * - `user-start`: User explicitly started the agent via UI or CLI
 * - `user-restart`: User explicitly restarted the agent via UI or CLI
 * - `ensure-agent-retry`: Auto-restart triggered by the ensure-agent scheduled check
 * - `test`: Used in integration and unit tests only
 */
export type StartAgentReason = 'user-start' | 'user-restart' | 'ensure-agent-retry' | 'test';

/**
 * Human-readable reasons for dispatching a stop-agent command.
 *
 * - `user-stop`: User explicitly stopped the agent via UI or CLI
 * - `dedup-stop`: Agent stopped automatically to deduplicate roles (another agent took over)
 * - `test`: Used in integration and unit tests only
 */
export type StopAgentReason = 'user-stop' | 'dedup-stop' | 'test';

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
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    agentHarness: 'opencode' | 'pi';
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
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
  };
}

/**
 * Ping the daemon to check connectivity.
 * @deprecated Replaced by daemon.ping event stream events (Phase C).
 */
export interface PingCommand {
  type: 'ping';
  payload: Record<string, never>;
}

/**
 * Query daemon status (hostname, OS, available harnesses).
 * @deprecated Replaced by daemon.ping event stream events (Phase C).
 */
export interface StatusCommand {
  type: 'status';
  payload: Record<string, never>;
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
  agentServices: Map<AgentHarness, RemoteAgentService>;
}
