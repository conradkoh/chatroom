/**
 * @deprecated Use {@link BoundHarness} instead.
 *
 * v1 interface for opening or resuming a session with a harness process.
 * Migrate to BoundHarness which provides:
 *   - Typed config via `NewSessionConfig` (vs raw `Record<string, unknown>`)
 *   - Self-contained lifecycle: spawn, sessions, shutdown in one interface
 *   - Built-in event routing via `EventRouterV2`
 *   - Plug-in replication bus support
 *
 * v2 consumers should depend on:
 *   - `BoundHarness` for session lifecycle (newSession, resumeSession, close)
 *   - `CapabilitiesCollector` (from publish-capabilities use case) for agent/provider discovery
 */

import type { DirectHarnessSession } from './direct-harness-session.js';
import type { HarnessSessionId } from './harness-session.js';

/**
 * @deprecated Use `NewSessionConfig` (in bound-harness.ts) instead.
 *
 * Options passed to the spawner when opening a new harness session.
 * Prefer the typed `NewSessionConfig` in new code.
 */
export interface OpenSessionOptions {
  /** Working directory for the harness process. */
  readonly cwd?: string;
  /** Additional environment variables for the harness process. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Harness-specific configuration.
   * Concrete spawners narrow this to their own typed config.
   */
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * @deprecated Use {@link BoundHarness} instead.
 *
 * v1 interface — each harness implementation (e.g. opencode-sdk) provides its own spawner.
 * Replaced by `BoundHarness.newSession()` / `BoundHarness.resumeSession()`.
 */
export interface DirectHarnessSpawner {
  /** Identifies this harness implementation, e.g. 'opencode-sdk'. */
  readonly harnessName: string;
  /** Start a new harness process and return the active session. */
  openSession(options: OpenSessionOptions): Promise<DirectHarnessSession>;
  /**
   * Reconnect to an existing harness process by its session identifier.
   * Used to recover from daemon restarts without losing harness state.
   */
  resumeSession(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession>;
}
