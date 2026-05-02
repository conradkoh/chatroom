/**
 * Interface for opening or resuming a session with a harness process.
 */

import type { DirectHarnessSession } from './direct-harness-session.js';
import type { HarnessSessionId } from './harness-session.js';

/** Options passed to the spawner when opening a new harness session. */
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
 * Responsible for opening and resuming sessions with a specific harness.
 * Each harness implementation (e.g. opencode-sdk) provides its own spawner.
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
