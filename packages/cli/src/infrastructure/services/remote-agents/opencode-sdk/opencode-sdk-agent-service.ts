/**
 * OpenCodeSdkAgentService — concrete RemoteAgentService using the OpenCode SDK.
 *
 * Uses @opencode-ai/sdk for session-based integration with OpenCode.
 * Spawns a local OpenCode server via child process, connects via SDK client,
 * and manages session lifecycle with the remote agent runtime.
 *
 * Extends BaseCLIAgentService which handles shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * isInstalled/getVersion helpers.
 */

import { execSync } from 'node:child_process';

import { createOpencodeClient } from '@opencode-ai/sdk';

import { buildChatroomAgentDescriptor } from './agent-config-builder.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { waitForListeningUrl } from './parse-listening-url.js';
import {
  FileSessionMetadataStore,
  type SessionMetadata,
  type SessionMetadataStore,
} from './session-metadata-store.js';
import { forwardFiltered, isInfoLine, parseModelId } from './pure.js';
import {
  startSessionEventForwarder,
  type SessionEventForwarderClient,
  type SessionEventForwarderHandle,
} from './session-event-forwarder.js';

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps & {
  sessionMetadataStore?: SessionMetadataStore;
};

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10000;
const CONFIG_UPDATE_TIMEOUT_MS = 10_000;
const SESSION_CREATE_TIMEOUT_MS = 30_000;
const PROMPT_ASYNC_TIMEOUT_MS = 60_000;
const SESSION_ABORT_TIMEOUT_MS = 5_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OpenCodeSdkAgentService extends BaseCLIAgentService {
  readonly id = 'opencode-sdk';
  readonly displayName = 'OpenCode (SDK)';
  readonly command = OPENCODE_COMMAND;
  private readonly sessionStore: SessionMetadataStore;
  private readonly forwarders = new Map<number, SessionEventForwarderHandle>();

  constructor(deps?: Partial<OpenCodeSdkAgentServiceDeps>) {
    super(deps);
    this.sessionStore = deps?.sessionMetadataStore ?? new FileSessionMetadataStore();
  }

  isInstalled(): boolean {
    // The SDK is a runtime dependency of this CLI package (declared in our
    // package.json), so it's guaranteed to be present whenever this code
    // executes. The only meaningful gate is the `opencode` binary itself.
    //
    // Historical note: an earlier version called `require.resolve('@opencode-ai/sdk')`,
    // which throws ReferenceError in pure ESM (this CLI is `"type": "module"`),
    // silently returning false from the catch and hiding the harness from the
    // picker. The runtime check is unnecessary — the dependency contract handles it.
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Fall back to CLI
    try {
      const output = this.deps
        .execSync(`${OPENCODE_COMMAND} models`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })
        .toString()
        .trim();

      if (!output) return [];

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }

  override async stop(pid: number): Promise<void> {
    const forwarder = this.forwarders.get(pid);
    if (forwarder) {
      forwarder.stop();
      this.forwarders.delete(pid);
    }

    const meta = this.sessionStore.findByPid(pid);
    if (meta) {
      try {
        const client = createOpencodeClient({ baseUrl: meta.baseUrl });
        await withTimeout(
          client.session.abort({ path: { id: meta.sessionId } }),
          SESSION_ABORT_TIMEOUT_MS,
          'session.abort'
        );
      } catch (err) {
        console.warn(
          `[opencode-sdk] session.abort for pid=${pid} sessionId=${meta.sessionId} failed (continuing with SIGTERM):`,
          err instanceof Error ? err.message : err
        );
      }
    }
    await super.stop(pid);
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;

    const childProcess = this.deps.spawn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const pid = childProcess.pid;

    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    const client = createOpencodeClient({
      baseUrl,
    });

    let sessionId: string | undefined;
    let forwarder: SessionEventForwarderHandle | undefined;
    try {
      const agentDescriptor = buildChatroomAgentDescriptor({
        role: context.role,
        systemPrompt,
      });

      await withTimeout(
        client.config.update({
          body: {
            agent: {
              [agentDescriptor.name]: agentDescriptor.config,
            },
          },
        }),
        CONFIG_UPDATE_TIMEOUT_MS,
        'config.update'
      );

      const sessionCreateResult = await withTimeout(
        client.session.create({ body: {} }),
        SESSION_CREATE_TIMEOUT_MS,
        'session.create'
      );

      if (!sessionCreateResult.data?.id) {
        throw new Error('Failed to create session');
      }

      sessionId = sessionCreateResult.data.id;

      forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
        sessionId,
        role: context.role,
      });

      const modelParts = model ? parseModelId(model) : undefined;
      const userMessage = prompt;
      await withTimeout(
        client.session.promptAsync({
          path: { id: sessionId },
          body: {
            agent: agentDescriptor.name,
            parts: [{ type: 'text', text: userMessage }],
            ...(modelParts ? { model: modelParts } : {}),
          },
        }),
        PROMPT_ASYNC_TIMEOUT_MS,
        'session.promptAsync'
      );
    } catch (err) {
      forwarder?.stop();
      childProcess.kill();
      if (sessionId) this.sessionStore.remove(sessionId);
      throw err;
    }

    const meta: SessionMetadata = {
      sessionId,
      machineId: context.machineId,
      chatroomId: context.chatroomId,
      role: context.role,
      pid,
      createdAt: new Date().toISOString(),
      baseUrl,
    };
    this.sessionStore.upsert(meta);

    const entry = this.registerProcess(pid, context);
    if (forwarder) this.forwarders.set(pid, forwarder);

    const outputCallbacks: (() => void)[] = [];

    forwardFiltered(childProcess.stdout, process.stdout, isInfoLine);
    forwardFiltered(childProcess.stderr, process.stderr, isInfoLine);

    if (childProcess.stdout) {
      childProcess.stdout.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }

    return {
      pid,
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          const fwd = this.forwarders.get(pid);
          if (fwd) {
            fwd.stop();
            this.forwarders.delete(pid);
          }
          this.sessionStore.remove(sessionId);
          this.deleteProcess(pid);
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
    };
  }
}
