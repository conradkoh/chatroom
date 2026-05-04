/**
 * v2 Domain types for the BoundHarness abstraction.
 *
 * BoundHarness is the replacement for the v1 `DirectHarnessSpawner` + `HarnessProcess`
 * split. It represents a harness process bound to a workspace with a single
 * cohesive interface:
 *   - List available models
 *   - Create new sessions (with typed `NewSessionConfig`)
 *   - Resume existing sessions
 *   - Manage process lifecycle
 *
 * Migration from v1:
 *   `DirectHarnessSpawner.openSession(OpenSessionOptions)` → `BoundHarness.newSession(NewSessionConfig)`
 *   `DirectHarnessSpawner.resumeSession(id)`              → `BoundHarness.resumeSession(id, opts?)`
 *   `HarnessProcess.isAlive()` / `.kill()`                → `BoundHarness.isAlive()` / `.close()`
 *   `HarnessProcess.listAgents()` / `.listProviders()`    → Use the `CapabilitiesCollector` port instead
 */

import type { HarnessSessionId, HarnessSessionRowId } from './harness-session.js';
import type { DirectHarnessSession, PromptInput } from './direct-harness-session.js';

// ─── BoundHarness ─────────────────────────────────────────────────────────────

/**
 * A harness process bound to a workspace.
 *
 * Consumers interact with this interface directly — the process spawning,
 * event routing, and session management are all internal details.
 */
export interface BoundHarness {
  /** Harness implementation identifier, e.g. 'opencode-sdk'. */
  readonly type: string;

  /** List available models for this workspace. */
  models(): Promise<readonly ModelInfo[]>;

  /** Create a new session with the given configuration. */
  newSession(config: NewSessionConfig): Promise<DirectHarnessSession>;

  /** Resume an existing session by its harness session ID. */
  resumeSession(
    sessionId: HarnessSessionId,
    options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession>;

  /** Whether the underlying process is still alive. */
  isAlive(): boolean;

  /** Tear down the harness process and release all resources. */
  close(): Promise<void>;
}

// ─── ModelInfo ────────────────────────────────────────────────────────────────

/** A single model available through this harness. */
export interface ModelInfo {
  /** Unique identifier, e.g. 'openai/gpt-4'. */
  readonly id: string;
  /** Human-readable name, e.g. 'GPT-4'. */
  readonly name: string;
  /** Provider name, e.g. 'OpenAI'. */
  readonly provider: string;
}

// ─── ResumeHarnessSessionOptions ─────────────────────────────────────────────

/** Optional metadata when resuming a session (e.g. replication to Convex). */
export interface ResumeHarnessSessionOptions {
  /**
   * `chatroom_harnessSessions` document id when it differs from the opencode
   * SDK session id. Omit only when replication is off or ids are 1:1.
   */
  readonly harnessSessionRowId?: HarnessSessionRowId;
}

// ─── NewSessionConfig ─────────────────────────────────────────────────────────

/** Configuration for a new session. */
export interface NewSessionConfig {
  /**
   * Optional title for the session. When omitted, opencode auto-generates
   * one (typically using a small model configured in the opencode app config).
   * The resolved title is always available on `session.sessionTitle`.
   */
  readonly title?: string;
  /**
   * Model identifier, e.g. 'openai/gpt-4'.
   * Use `models()` to discover available IDs.
   */
  readonly model?: string;
  /** System prompt for the session. */
  readonly systemPrompt?: string;
  /** Default agent for this session (e.g. 'builder', 'planner'). */
  readonly agent?: string;
  /**
   * `chatroom_harnessSessions` document id for replication. Pass this when the
   * backend row exists before the harness session (typical daemon flow). If
   * omitted, the SDK session id is used as the replication key (tests / 1:1).
   */
  readonly harnessSessionRowId?: HarnessSessionRowId;
}

// ─── startBoundHarness ────────────────────────────────────────────────────────

/** Configuration for starting a bound harness. */
export interface StartBoundHarnessConfig {
  /** Harness implementation type. */
  readonly type: 'opencode';
  /** Working directory for the harness process. */
  readonly workingDir: string;
  /** Workspace identifier (used for session metadata and process tracking). */
  readonly workspaceId: string;
}

/** Factory function type — implemented by each harness backend. */
export type BoundHarnessFactory = (
  config: StartBoundHarnessConfig
) => Promise<BoundHarness>;
