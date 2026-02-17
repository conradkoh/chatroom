/**
 * Daemon Types — shared type definitions for the daemon command module.
 */

import type { DaemonDeps } from './deps.js';
import type { Id } from '../../../api.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';

// ─── Session & Config Types ─────────────────────────────────────────────────

/**
 * Named type alias for the session ID passed to Convex mutations/queries.
 * The Convex SessionIdArg expects a specific branded type, but our sessionId
 * is a plain string from local storage. This alias documents intent and
 * avoids bare `any` in every function signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionId = any;

export type { MachineConfig };

// ─── Command Types ──────────────────────────────────────────────────────────

/**
 * Base fields shared across all machine commands.
 */
export interface MachineCommandBase {
  _id: Id<'chatroom_machineCommands'>;
  createdAt: number;
}

/**
 * Start an agent process in a chatroom.
 * Requires chatroomId, role, and agentHarness. Model and workingDir are optional.
 */
export interface StartAgentCommand extends MachineCommandBase {
  type: 'start-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    agentHarness: 'opencode';
    model?: string;
    workingDir?: string;
  };
}

/**
 * Stop a running agent process in a chatroom.
 * Requires chatroomId and role to identify the target agent.
 */
export interface StopAgentCommand extends MachineCommandBase {
  type: 'stop-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
  };
}

/**
 * Ping the daemon to check connectivity.
 */
export interface PingCommand extends MachineCommandBase {
  type: 'ping';
  payload: Record<string, never>;
}

/**
 * Query daemon status (hostname, OS, available harnesses).
 */
export interface StatusCommand extends MachineCommandBase {
  type: 'status';
  payload: Record<string, never>;
}

/**
 * Discriminated union of all machine commands.
 * The `type` field determines which payload shape is available,
 * enabling TypeScript to narrow types in switch/case branches.
 */
export type MachineCommand = StartAgentCommand | StopAgentCommand | PingCommand | StatusCommand;

/**
 * Raw command shape as received from the Convex backend subscription.
 * All payload fields are optional because Convex uses a single flat schema
 * for all command types.
 */
export interface RawMachineCommand {
  _id: Id<'chatroom_machineCommands'>;
  type: 'start-agent' | 'stop-agent' | 'ping' | 'status';
  payload: {
    chatroomId?: Id<'chatroom_rooms'>;
    role?: string;
    agentHarness?: 'opencode';
    model?: string;
    workingDir?: string;
  };
  createdAt: number;
}

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
}
