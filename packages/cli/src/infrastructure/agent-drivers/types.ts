/**
 * Agent Harness Driver — Type Contracts
 *
 * Defines the unified interface for interacting with AI agent harnesses
 * (OpenCode). Each harness implements AgentHarnessDriver
 * to provide a consistent API for starting, stopping, and querying agents.
 *
 * Boundary: This module defines driver contracts and capabilities.
 * Machine identity, registration, and config file types live in
 * `infrastructure/machine/types.ts`. Drivers import from `machine/types.ts`
 * but `machine/` should never import from `agent-drivers/`.
 */

import type { AgentHarness, HarnessVersionInfo } from '../machine/types.js';

// ─── Capabilities ────────────────────────────────────────────────────────────

/**
 * Declares what an agent harness supports at runtime.
 * Used by the daemon and UI to adapt behavior per harness.
 */
export interface AgentCapabilities {
  /** Can persist and resume sessions across daemon restarts */
  sessionPersistence: boolean;
  /** Can abort a running agent without killing the OS process */
  abort: boolean;
  /** Supports selecting a specific AI model at start time */
  modelSelection: boolean;
  /** Can compact/summarize conversation context mid-session */
  compaction: boolean;
  /** Can stream real-time events (tool calls, messages) */
  eventStreaming: boolean;
  /** Can inject messages into an existing session */
  messageInjection: boolean;
  /** Can list available models dynamically at runtime */
  dynamicModelDiscovery: boolean;
}

// ─── Start Options ───────────────────────────────────────────────────────────

/**
 * Input for starting an agent session or process.
 */
export interface AgentStartOptions {
  /** Absolute path to the working directory on the host machine */
  workingDir: string;
  /** Role prompt (system-level instructions for the agent) */
  rolePrompt: string;
  /** Initial message (first user message / task description) */
  initialMessage: string;
  /** AI model to use (respected only if modelSelection capability is true) */
  model?: string;
  /** Harness version info for version-specific spawn logic */
  harnessVersion?: HarnessVersionInfo;
}

// ─── Agent Handle ────────────────────────────────────────────────────────────

/**
 * Opaque reference to a running agent.
 *
 * For process-based drivers, the handle wraps an OS PID.
 * For SDK/session-based drivers, it wraps a session ID + server URL.
 * The daemon stores handles in Convex so they survive restarts.
 */
export interface AgentHandle {
  /** Which harness owns this handle */
  harness: AgentHarness;
  /** Handle type determines interaction semantics */
  type: 'process' | 'session';
  /** OS process ID (for process-based drivers) */
  pid?: number;
  /** SDK session ID (for session-based drivers) */
  sessionId?: string;
  /** Server URL for reconnection (for session-based drivers) */
  serverUrl?: string;
  /** Working directory the agent is running in */
  workingDir: string;
}

// ─── Driver Start Result ─────────────────────────────────────────────────────

/**
 * Callback signature for process exit events.
 * Invoked when a spawned agent process exits (expected or unexpected).
 */
export type ProcessExitCallback = (code: number | null, signal: string | null) => void;

/**
 * Result of a driver's start() call, including backward-compatible fields.
 * This extends the AgentHandle with success/message for the daemon.
 */
export interface DriverStartResult {
  success: boolean;
  message: string;
  handle?: AgentHandle;
  /**
   * Register a callback to be invoked when the spawned process exits.
   * Only available for process-based drivers. The daemon uses this to
   * detect unexpected agent death and clear the PID in the backend.
   *
   * The callback receives the exit code and signal (one of which may be null).
   */
  onExit?: (callback: ProcessExitCallback) => void;
}

// ─── Driver Interface ────────────────────────────────────────────────────────

/**
 * Common interface for all agent harness drivers.
 *
 * Each AI harness (e.g. OpenCode) implements this interface.
 * The daemon resolves drivers from the DriverRegistry and interacts
 * with them through this contract.
 */
export interface AgentHarnessDriver {
  /** Harness identifier (e.g. 'opencode') */
  readonly harness: AgentHarness;

  /** Static capability declaration — what this tool supports */
  readonly capabilities: AgentCapabilities;

  /**
   * Start an agent session or process.
   * Returns a result with a handle for further interaction.
   */
  start(options: AgentStartOptions): Promise<DriverStartResult>;

  /**
   * Stop/abort an agent by its handle.
   * For process-based drivers: sends SIGTERM.
   * For session-based drivers: calls the abort API.
   */
  stop(handle: AgentHandle): Promise<void>;

  /**
   * Check if an agent is still running/active.
   * For process-based drivers: checks PID liveness via kill -0.
   * For session-based drivers: queries session status via SDK.
   */
  isAlive(handle: AgentHandle): Promise<boolean>;

  /**
   * Recover handles for agents that survived a daemon restart.
   * Returns handles for all recoverable agents managed by this driver.
   * For process-based drivers: this is a no-op (process PIDs aren't recoverable).
   * For session-based drivers: queries the SDK for active sessions.
   */
  recover(workingDir: string): Promise<AgentHandle[]>;

  /**
   * List available AI models (if dynamicModelDiscovery is true).
   * Returns an empty array if the harness doesn't support dynamic discovery.
   */
  listModels(): Promise<string[]>;
}

// ─── Driver Registry ─────────────────────────────────────────────────────────

/**
 * Resolves AgentHarnessDriver instances by harness name.
 * The daemon uses this to dispatch commands to the correct driver.
 */
export interface DriverRegistry {
  /** Get the driver for a specific harness. Throws if harness is not registered. */
  get(harness: AgentHarness): AgentHarnessDriver;

  /** Get all registered drivers */
  all(): AgentHarnessDriver[];

  /** Get capabilities for a specific harness. Throws if harness is not registered. */
  capabilities(harness: AgentHarness): AgentCapabilities;
}
