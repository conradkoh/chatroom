/**
 * BoundHarness implementation for the opencode SDK.
 *
 * Manages the lifecycle of the opencode SDK process:
 *   - Spawns the process and waits for it to be ready
 *   - Creates and resumes SDK sessions
 *   - Exposes available models
 *   - Provides isAlive / close for process lifecycle
 */

import type { BoundHarness, ModelInfo, NewSessionConfig, ResumeHarnessSessionOptions } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

export interface OpencodeSdkHarnessOptions {
  /** Working directory for the harness process. */
  readonly cwd: string;
  /** The opencode SDK client instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any;
}

export class OpencodeSdkHarness implements BoundHarness {
  readonly type = 'opencode-sdk' as const;

  constructor(private readonly options: OpencodeSdkHarnessOptions) {}

  async models(): Promise<readonly ModelInfo[]> {
    // TODO: Implement — read available models from the opencode config
    throw new Error('Not implemented');
  }

  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    // TODO: Implement — create a new SDK session
    throw new Error('Not implemented');
  }

  async resumeSession(
    sessionId: HarnessSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    // TODO: Implement — reattach to an existing SDK session
    throw new Error('Not implemented');
  }

  isAlive(): boolean {
    // TODO: Implement — check process health
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    // TODO: Implement — kill the process
    throw new Error('Not implemented');
  }
}
