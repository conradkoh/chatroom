/**
 * Daemon Types — shared type definitions for the daemon command module.
 */

import type {
  AgentStartReason,
  AgentStopReason,
} from '@workspace/backend/src/domain/entities/agent';

import type { DaemonDeps } from './deps.js';
import type { Id } from '../../../api.js';
import type { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { StopReason } from '../../../infrastructure/machine/stop-reason.js';
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
    chatroomId: Id<'chatroom_rooms'>;
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
    chatroomId: Id<'chatroom_rooms'>;
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

/**
 * Build a unique key for an agent in a chatroom.
 * Role is lowercased for case-insensitive matching.
 */
export function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

/**
 * Serialize an async operation through the per-agent spawn lock.
 *
 * Ensures that only one spawn/start operation runs at a time for a given
 * (chatroomId, role). Concurrent callers (e.g., command loop and task monitor)
 * are chained — the second caller waits for the first to complete before running.
 *
 * The lock is automatically cleaned up after the chain resolves to prevent memory leaks.
 */
export async function withSpawnLock<T>(
  ctx: DaemonContext,
  chatroomId: string,
  role: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = agentKey(chatroomId, role);
  const prev = ctx.spawnLocks.get(key) ?? Promise.resolve();

  let resolve!: () => void;
  // Create a new promise that the chain tracks. This decouples the chain's
  // promise (void) from the fn's return value (T).
  const gate = new Promise<void>((r) => {
    resolve = r;
  });

  // Chain the gate onto the previous lock entry so subsequent callers wait.
  ctx.spawnLocks.set(
    key,
    prev.then(
      () => gate,
      () => gate
    )
  );

  // Wait for the previous operation to complete before running ours.
  await prev.catch(() => {});

  try {
    return await fn();
  } finally {
    resolve();
    // Clean up the lock entry if we're at the end of the chain
    // (no other operations have been chained after us)
    const current = ctx.spawnLocks.get(key);
    if (current) {
      // Check if the chain has settled (no new operations chained)
      current
        .then(() => {
          if (ctx.spawnLocks.get(key) === current) {
            ctx.spawnLocks.delete(key);
          }
        })
        .catch(() => {});
    }
  }
}

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
   * Set of active working directories being tracked for git state.
   * Populated when agents start (via start-agent handler) and on daemon startup
   * (via state recovery). Used by the heartbeat to know which directories to collect.
   */
  activeWorkingDirs: Set<string>;
  /**
   * Tracks the last git state pushed for each workspace (keyed by `machineId::workingDir`).
   * Value is a hash of the git state (branch + isDirty + diffStat) used for change detection.
   * Only push to backend when this hash changes.
   */
  lastPushedGitState: Map<string, string>;
  /**
   * Tracks pending stop reasons for agents being intentionally stopped.
   * Key: `${chatroomId}:${role}` → stop reason.
   * Set by onAgentShutdown BEFORE killing the process, read by the onExit
   * callback in start-agent.ts to correctly classify intentional exits.
   */
  pendingStops: Map<string, StopReason>;
  /**
   * Per-agent spawn lock — serializes `executeStartAgent()` calls for the same
   * (chatroomId, role) to prevent the race condition where both the command loop
   * and task monitor spawn an agent concurrently.
   *
   * Key: `${chatroomId}:${role}` (via agentKey()).
   * Value: Promise chain — each new spawn attempt chains onto the previous one.
   *
   * When a spawn is in progress, the task monitor and command loop both go through
   * this lock, ensuring only one spawn completes for a given agent at a time.
   */
  spawnLocks: Map<string, Promise<void>>;
}
