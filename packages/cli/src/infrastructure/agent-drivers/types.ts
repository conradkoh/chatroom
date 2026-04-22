/**
 * AgentToolDriver — unified interface for AI agent tool integrations.
 *
 * Each harness (opencode, cursor, claude, etc.) implements AgentToolDriver.
 * The daemon resolves drivers from the DriverRegistry and interacts with
 * them through this common contract, enabling polymorphic dispatch and
 * capability-based feature detection.
 *
 * Note: We use AgentHarness (from the backend entity) as the driver key
 * rather than introducing a parallel AgentTool type. This keeps the type
 * surface consistent with the existing codebase.
 */

import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent';

export type { AgentHarness };

// ─── Capabilities ─────────────────────────────────────────────────────────────

/** Declares what features a given agent tool supports. */
export interface AgentCapabilities {
  /** Can persist and resume sessions across restarts */
  sessionPersistence: boolean;
  /** Can abort a running agent without killing the process */
  abort: boolean;
  /** Supports selecting a specific AI model */
  modelSelection: boolean;
  /** Can compact/summarize conversation context */
  compaction: boolean;
  /** Can stream real-time events (tool calls, messages) */
  eventStreaming: boolean;
  /** Can inject messages into an existing session */
  messageInjection: boolean;
  /** Can list available models dynamically */
  dynamicModelDiscovery: boolean;
}

// ─── Agent Handle ─────────────────────────────────────────────────────────────

/** Opaque reference to a running agent instance. */
export interface AgentHandle {
  /** Harness that owns this handle */
  harness: AgentHarness;
  /** Handle type determines how to interact with the agent */
  type: 'process' | 'session';
  /** Process-based: OS PID */
  pid?: number;
  /** Session-based: SDK session ID */
  sessionId?: string;
  /** Session-based: server URL for reconnection */
  serverUrl?: string;
  /** Working directory the agent is running in */
  workingDir: string;
}

// ─── Start Options ────────────────────────────────────────────────────────────

/** Input required to start an agent session. */
export interface AgentStartOptions {
  /** Working directory to run in */
  workingDir: string;
  /** Role/system prompt — establishes the agent's identity and context */
  rolePrompt: string;
  /** Initial message — the first user message delivered to the agent */
  initialMessage: string;
  /** AI model to use (only when modelSelection capability is true) */
  model?: string;
}

// ─── Driver Interface ─────────────────────────────────────────────────────────

/** Common interface for all agent tool drivers. */
export interface AgentToolDriver {
  /** Harness identifier — matches AgentHarness from the backend */
  readonly harness: AgentHarness;

  /** Static capability declaration */
  readonly capabilities: AgentCapabilities;

  /**
   * Start an agent session/process.
   * Returns a handle for further interaction.
   */
  start(options: AgentStartOptions): Promise<AgentHandle>;

  /**
   * Stop/abort an agent by its handle.
   * For process-based: sends SIGTERM to the process group.
   * For session-based: calls the abort API.
   */
  stop(handle: AgentHandle): Promise<void>;

  /**
   * Check if an agent is still running/active.
   * For process-based: checks PID liveness.
   * For session-based: queries session status.
   */
  isAlive(handle: AgentHandle): boolean;

  /**
   * List available models (if dynamicModelDiscovery is true).
   * Returns empty array if not supported.
   */
  listModels(): Promise<string[]>;

  /**
   * Recover running agent sessions after a daemon restart (optional).
   * Only supported when sessionPersistence capability is true.
   * Returns handles for any sessions that are still alive.
   */
  recover?(workingDir: string): Promise<AgentHandle[]>;

  /**
   * Summarize/compact a session (optional).
   * Only supported when compaction capability is true.
   * No-op if not implemented.
   */
  summarize?(handle: AgentHandle): Promise<void>;
}

// ─── Driver Registry Interface ────────────────────────────────────────────────

/** Registry for resolving drivers by harness key. */
export interface DriverRegistry {
  /** Get the driver for a specific harness */
  get(harness: AgentHarness): AgentToolDriver;

  /** Get all registered drivers */
  all(): AgentToolDriver[];

  /** Get capabilities for a harness */
  capabilities(harness: AgentHarness): AgentCapabilities;
}
