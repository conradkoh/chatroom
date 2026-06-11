/**
 * Daemon Types — shared type definitions for the daemon command module.
 */

import type {
  AgentStartReason,
  AgentStopReason,
} from '@workspace/backend/src/domain/entities/agent';

import type { MachineStateOps, SpawningOps } from './deps.js';
import type { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { BackendOps, FsOps } from '../../../infrastructure/deps/index.js';
import type { AgentHarness, MachineConfig } from '../../../infrastructure/machine/types.js';
import type { AgentProcessManager } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
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

// Re-export from canonical source (services/backend/src/domain/direct-harness/entities/agent.ts)
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

/** Minimal workspace row used by daemon sync paths. */
export interface WorkspaceForSync {
  workingDir: string;
}

/** Convex client type used throughout the daemon. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConvexClient = any;

// ─── Daemon Session Init (W10 — flat bootstrap shape) ───────────────────────

/**
 * Flat bootstrap data for building Effect service layers.
 * Used at the init → layer boundary (W10 migration complete).
 *
 * Key difference from the old nested shape: deps are flattened — `backend` and `fs`
 * are top-level fields, not nested under `deps`.
 */
export interface DaemonSessionInit {
  // ─── Identity ─────────────────────────────────────────────────────
  client: ConvexClient;
  sessionId: SessionId;
  machineId: string;
  config: MachineConfig | null;

  // ─── Flat deps (no .deps. indirection) ────────────────────────────
  backend: BackendOps;
  fs: FsOps;
  machine: MachineStateOps;
  spawning: SpawningOps;
  agentProcessManager: AgentProcessManager;

  // ─── Shared data ──────────────────────────────────────────────────
  events: DaemonEventBus;
  agentServices: Map<string, RemoteAgentService>;
  workspaceListStore?: {
    workspaces: WorkspaceForSync[];
    updatedAt: number;
  };
  logger?: Pick<Console, 'log' | 'warn'>;

  // ─── Mutable state (shared reference semantics) ───────────────────
  lastPushedGitState: Map<string, string>;
  lastPushedModels: Record<string, string[]> | null;
  lastPushedHarnessFingerprint: string | null;
}
