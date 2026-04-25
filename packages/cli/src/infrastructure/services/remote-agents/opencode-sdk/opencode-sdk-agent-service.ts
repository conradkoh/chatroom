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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { createOpencodeClient } from '@opencode-ai/sdk';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { waitForListeningUrl } from './parse-listening-url.js';

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps;

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_AGENT_NAME = 'build';
const SESSION_METADATA_PATH = join(homedir(), '.chatroom', 'opencode-sdk-sessions.json');
const SERVE_STARTUP_TIMEOUT_MS = 10000;
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

function findSessionMetadataByPid(pid: number): SessionMetadata | undefined {
  const sessions = loadSessionMetadata();
  return Object.values(sessions).find((m) => m.pid === pid);
}

function forwardFiltered(
  source: NodeJS.ReadableStream | undefined,
  target: NodeJS.WritableStream,
  shouldDrop: (line: string) => boolean
): void {
  if (!source) return;
  let buf = '';
  source.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!shouldDrop(line)) target.write(line + '\n');
    }
  });
  source.on('end', () => {
    if (buf.length > 0 && !shouldDrop(buf)) target.write(buf);
    buf = '';
  });
}

const isInfoLine = (line: string): boolean => line.trimStart().startsWith('INFO ');

interface SessionMetadata {
  sessionId: string;
  machineId: string;
  chatroomId: string;
  role: string;
  pid: number;
  createdAt: string;
  baseUrl: string;
}

function loadSessionMetadata(): Record<string, SessionMetadata> {
  try {
    if (existsSync(SESSION_METADATA_PATH)) {
      return JSON.parse(readFileSync(SESSION_METADATA_PATH, 'utf-8'));
    }
  } catch {
    // Ignore errors, return empty object
  }
  return {};
}

function saveSessionMetadata(sessions: Record<string, SessionMetadata>): void {
  try {
    const dir = join(homedir(), '.chatroom');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(SESSION_METADATA_PATH, JSON.stringify(sessions, null, 2));
  } catch {
    // Ignore errors for now
  }
}

function updateSessionMetadata(sessionId: string, meta: SessionMetadata): void {
  const sessions = loadSessionMetadata();
  sessions[sessionId] = meta;
  saveSessionMetadata(sessions);
}

function removeSessionMetadata(sessionId: string): void {
  const sessions = loadSessionMetadata();
  delete sessions[sessionId];
  saveSessionMetadata(sessions);
}

/**
 * Parse an OpenCode model ID like "anthropic/claude-sonnet-4" or
 * "github-copilot/claude-sonnet-4.5" into the SDK's `{providerID, modelID}` shape.
 *
 * Splits on the FIRST slash so model slugs containing `/` (rare, but possible)
 * are preserved in the modelID portion. Returns undefined for inputs without
 * any `/` (no provider prefix → we cannot determine the provider).
 */
function parseModelId(model: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const slashIdx = model.indexOf('/');
  if (slashIdx === -1) return undefined;
  const providerID = model.substring(0, slashIdx);
  const modelID = model.substring(slashIdx + 1);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export class OpenCodeSdkAgentService extends BaseCLIAgentService {
  readonly id = 'opencode-sdk';
  readonly displayName = 'OpenCode (SDK)';
  readonly command = OPENCODE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
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
    const meta = findSessionMetadataByPid(pid);
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
    try {
      const sessionCreateResult = await withTimeout(
        client.session.create({ body: {} }),
        SESSION_CREATE_TIMEOUT_MS,
        'session.create'
      );

      if (!sessionCreateResult.data?.id) {
        throw new Error('Failed to create session');
      }

      sessionId = sessionCreateResult.data.id;

      const modelParts = model ? parseModelId(model) : undefined;
      const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
      await withTimeout(
        client.session.promptAsync({
          path: { id: sessionId },
          body: {
            agent: DEFAULT_AGENT_NAME,
            parts: [{ type: 'text', text: combinedPrompt }],
            ...(modelParts ? { model: modelParts } : {}),
          },
        }),
        PROMPT_ASYNC_TIMEOUT_MS,
        'session.promptAsync'
      );
    } catch (err) {
      childProcess.kill();
      if (sessionId) removeSessionMetadata(sessionId);
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
    updateSessionMetadata(sessionId, meta);

    const entry = this.registerProcess(pid, context);

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
          removeSessionMetadata(sessionId);
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
