/**
 * Daemon Deps — Dependency interfaces for daemon command handlers.
 *
 * Applies interface segregation: each handler declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 *
 * Shared interfaces (BackendOps, ProcessOps, ClockOps, FsOps) are imported
 * from infrastructure/deps/ for reuse across other commands.
 *
 * Domain-specific interfaces (IntentionalStopOps, MachineStateOps)
 * live here because they are specific to the daemon command module.
 */

import type {
  BackendOps,
  ClockOps,
  FsOps,
  ProcessOps,
} from '../../../infrastructure/deps/index.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';

// ─── Domain-Specific Interfaces ─────────────────────────────────────────────

/**
 * Intentional stop tracking — marks/consumes stops to distinguish
 * intentional stops from crashes.
 */
export interface IntentionalStopOps {
  /** Mark an agent as being intentionally stopped */
  mark: (chatroomId: string, role: string) => void;
  /** Check and consume an intentional stop marker. Returns true if was intentional. */
  consume: (chatroomId: string, role: string) => boolean;
  /** Clear the marker without consuming (on failure cleanup) */
  clear: (chatroomId: string, role: string) => void;
}

/**
 * Local machine state operations — PID persistence, agent context.
 */
export interface MachineStateOps {
  /** Clear an agent's PID from local state */
  clearAgentPid: (machineId: string, chatroomId: string, role: string) => void;
  /** Persist a spawned agent's PID for restart recovery */
  persistAgentPid: (
    machineId: string,
    chatroomId: string,
    role: string,
    pid: number,
    harness: AgentHarness
  ) => void;
  /** List all persisted agent entries for a machine */
  listAgentEntries: (
    machineId: string
  ) => { chatroomId: string; role: string; entry: { pid: number; harness: AgentHarness } }[];
  /** Persist the event stream cursor (last processed event ID) */
  persistEventCursor: (machineId: string, lastSeenEventId: string) => void;
  /** Load the event stream cursor from persisted state. Returns null if absent. */
  loadEventCursor: (machineId: string) => string | null;
}

// ─── Per-Handler Dep Interfaces ─────────────────────────────────────────────

/** Dependencies for handleStartAgent */
export interface StartAgentDeps {
  backend: BackendOps;
  fs: FsOps;
  machine: Pick<MachineStateOps, 'persistAgentPid' | 'listAgentEntries'>;
  stops: Pick<IntentionalStopOps, 'consume'>;
}

/** Dependencies for handleStopAgent */
export interface StopAgentDeps {
  backend: BackendOps;
  processes: ProcessOps;
  machine: Pick<MachineStateOps, 'clearAgentPid' | 'listAgentEntries'>;
  stops: Pick<IntentionalStopOps, 'mark' | 'clear'>;
}

/** Dependencies for recoverAgentState */
export interface StateRecoveryDeps {
  backend: BackendOps;
  machine: Pick<MachineStateOps, 'listAgentEntries' | 'clearAgentPid'>;
}

// ─── Aggregated DaemonDeps ──────────────────────────────────────────────────

/**
 * All external dependencies for daemon command handlers.
 *
 * This aggregate satisfies all per-handler dep interfaces, so the
 * DaemonContext can carry a single object that works for every handler.
 *
 * In production, created via `createDefaultDeps()`.
 * In tests, partially mocked for specific test scenarios.
 */
export interface DaemonDeps {
  backend: BackendOps;
  processes: ProcessOps;
  fs: FsOps;
  stops: IntentionalStopOps;
  machine: MachineStateOps;
  clock: ClockOps;
}
