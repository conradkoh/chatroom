/**
 * OpencodeSdkHarness — BoundHarness implementation for the opencode SDK.
 *
 * Lifecycle:
 *   1. `startOpencodeSdkHarness()` spawns `opencode serve --print-logs`,
 *      waits for the listening URL, and returns a BoundHarness.
 *   2. `newSession()` creates a new SDK session and returns an OpencodeSdkSession.
 *   3. `resumeSession()` returns an OpencodeSdkSession for an existing session ID.
 *   4. `models()` reads providers/models from the running SDK server.
 *   5. `isAlive()` checks the child process.
 *   6. `close()` sends SIGTERM and cleans up.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';

import type { BoundHarness, ModelInfo, NewSessionConfig, ResumeHarnessSessionOptions, BoundHarnessFactory } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { OpencodeSdkSession } from './opencode-session.js';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10_000;

// ─── Options ──────────────────────────────────────────────────────────────────

export interface OpencodeSdkHarnessOptions {
  /** Working directory for the harness process. */
  readonly cwd: string;
  /** OpenCode SDK client instance, already connected to a running server. */
  readonly client: OpencodeClient;
  /** Child process reference (for isAlive / close). */
  readonly process: ChildProcess;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class OpencodeSdkHarness implements BoundHarness {
  readonly type = 'opencode-sdk' as const;

  private readonly client: OpencodeClient;
  private readonly childProcess: ChildProcess;
  private readonly cwd: string;
  private closed = false;

  constructor(options: OpencodeSdkHarnessOptions) {
    this.client = options.client;
    this.childProcess = options.process;
    this.cwd = options.cwd;
  }

  /** List available models via the opencode provider list. */
  async models(): Promise<readonly ModelInfo[]> {
    const result = await this.client.provider.list();
    const providers = result.data?.all ?? [];

    const models: ModelInfo[] = [];
    for (const provider of providers) {
      for (const [key, model] of Object.entries(provider.models ?? {})) {
        models.push({
          id: key, // e.g. "openai/gpt-4"
          name: model.name,
          provider: provider.name,
        });
      }
    }
    return models;
  }

  /** Create a new SDK session. */
  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const created = await this.client.session.create({
      body: {
        ...(config.title ? { title: config.title } : {}),
      },
      query: {
        directory: this.cwd,
      },
    });

    const sessionId = created.data?.id;
    if (!sessionId) {
      throw new Error('Failed to create session: no session ID returned');
    }

    // Fetch the session title from the harness (it auto-generates one)
    let sessionTitle = config.title ?? '';
    try {
      const sessionInfo = await this.client.session.get({
        path: { id: sessionId },
      });
      sessionTitle = sessionInfo.data?.title ?? sessionTitle;
    } catch {
      // Non-fatal — fall back to the requested title or empty string
    }

    return new OpencodeSdkSession({
      baseUrl: this.extractBaseUrl(),
      harnessSessionId: sessionId,
      sessionTitle,
    });
  }

  /** Resume an existing SDK session by its harness session ID. */
  async resumeSession(
    sessionId: HarnessSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    // Verify the session still exists
    let sessionTitle = '';
    try {
      const sessionInfo = await this.client.session.get({
        path: { id: sessionId },
      });
      sessionTitle = sessionInfo.data?.title ?? '';
    } catch {
      throw new Error(`Session ${sessionId} not found on the harness`);
    }

    return new OpencodeSdkSession({
      baseUrl: this.extractBaseUrl(),
      harnessSessionId: sessionId,
      sessionTitle,
    });
  }

  /** Whether the underlying process is still alive. */
  isAlive(): boolean {
    if (this.closed) return false;
    return this.childProcess.exitCode === null && this.childProcess.killed === false;
  }

  /** Tear down the harness process and release all resources. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Send SIGTERM, then SIGKILL after a grace period
    this.childProcess.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.childProcess.kill('SIGKILL');
        resolve();
      }, 5_000);

      this.childProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Extract the base URL from the opencode client's config. */
  private extractBaseUrl(): string {
    // The client stores the base URL we provided; reconstruct it from the
    // internal config. This is a workaround since we don't export the baseUrl
    // separately. An alternative is to store it ourselves during construction.
    return (this.client as unknown as { config?: { baseUrl?: string } }).config
      ?.baseUrl ?? 'http://127.0.0.1:15432';
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Factory function: spawn the opencode process, wait for the URL, create the
 * client, and return a BoundHarness.
 */
export const startOpencodeSdkHarness: BoundHarnessFactory = async (config) => {
  const childProcess = spawn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
    cwd: config.workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      GIT_EDITOR: 'true',
      GIT_SEQUENCE_EDITOR: 'true',
    },
  });

  if (!childProcess.pid) {
    throw new Error('Failed to spawn opencode serve process');
  }

  try {
    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    });

    const client = createOpencodeClient({ baseUrl });

    return new OpencodeSdkHarness({
      cwd: config.workingDir,
      client: client as unknown as OpencodeClient,
      process: childProcess,
    });
  } catch (err) {
    // Kill the process on any startup failure
    childProcess.kill('SIGKILL');
    throw err;
  }
};
