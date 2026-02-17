/**
 * Daemon Dependencies — Dependency Inversion for Command Handlers
 *
 * Defines the `DaemonDeps` interface that encapsulates all external dependencies
 * used by daemon command handlers (handleStartAgent, handleStopAgent,
 * handleAgentCrashRecovery, etc.).
 *
 * By injecting dependencies through this interface rather than importing them
 * directly, command handlers become unit-testable with mock implementations.
 *
 * Usage:
 * - Production: `createDefaultDeps()` wires up real implementations
 * - Tests: create partial mocks via spread override on `createDefaultDeps()`
 */

import type { Stats } from 'node:fs';

import type { AgentHarnessDriver } from '../../infrastructure/agent-drivers/types.js';
import type { AgentContext, AgentHarness } from '../../infrastructure/machine/types.js';

// ─── Dependency Interfaces ───────────────────────────────────────────────────

/**
 * Backend (Convex) operations — mutations and queries.
 * Wraps the Convex client to decouple handlers from the transport layer.
 */
export interface BackendOps {
  /** Call a Convex mutation */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
  /** Call a Convex query */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (endpoint: any, args: any) => Promise<any>;
}

/**
 * OS process operations — kill, existence check, PID ownership verification.
 */
export interface ProcessOps {
  /** Send a signal to a process (wraps process.kill) */
  kill: (pid: number, signal?: NodeJS.Signals | number) => void;
  /** Verify a PID belongs to the expected harness */
  verifyPidOwnership: (pid: number, expectedHarness?: string) => boolean;
}

/**
 * Agent driver registry — resolves harness drivers for start/stop/isAlive.
 */
export interface DriverOps {
  /** Get the driver for a specific harness. Throws if not registered. */
  get: (harness: AgentHarness) => AgentHarnessDriver;
  /** Get all registered drivers */
  all: () => AgentHarnessDriver[];
}

/**
 * File system operations used by command handlers.
 */
export interface FsOps {
  /** Get file/directory stats (wraps fs.stat) */
  stat: (path: string) => Promise<Stats>;
}

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
  /** Get agent context (working dir, harness) for a chatroom role */
  getAgentContext: (chatroomId: string, role: string) => AgentContext | null;
  /** Update agent context with new working dir / harness */
  updateAgentContext: (
    chatroomId: string,
    role: string,
    harness: AgentHarness,
    workingDir: string
  ) => void;
}

/**
 * Clock operations — for testable time and delays.
 */
export interface ClockOps {
  /** Get current timestamp in milliseconds */
  now: () => number;
  /** Async delay (wraps setTimeout) */
  delay: (ms: number) => Promise<void>;
}

// ─── Aggregated DaemonDeps ───────────────────────────────────────────────────

/**
 * All external dependencies for daemon command handlers.
 *
 * In production, created via `createDefaultDeps()`.
 * In tests, partially mocked for specific test scenarios.
 */
export interface DaemonDeps {
  backend: BackendOps;
  processes: ProcessOps;
  drivers: DriverOps;
  fs: FsOps;
  stops: IntentionalStopOps;
  machine: MachineStateOps;
  clock: ClockOps;
}
