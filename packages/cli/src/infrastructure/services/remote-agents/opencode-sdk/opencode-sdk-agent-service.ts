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

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps;

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_AGENT_NAME = 'build';
const SESSION_METADATA_PATH = join(homedir(), '.chatroom', 'opencode-sdk-sessions.json');
const SERVE_STARTUP_TIMEOUT_MS = 10000;

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

function parseModelId(model: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const parts = model.split('/');
  if (parts.length !== 2) return undefined;
  return { providerID: parts[0], modelID: parts[1] };
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

    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('opencode serve did not print a listening URL within 10s')),
        SERVE_STARTUP_TIMEOUT_MS
      );

      const onData = (buf: Buffer) => {
        const s = buf.toString();
        const match = s.match(/https?:\/\/[^\s]+/);
        if (match) {
          clearTimeout(timer);
          childProcess.stdout?.removeListener('data', onData);
          childProcess.stderr?.removeListener('data', onData);
          resolve(match[0]);
        }
      };

      childProcess.stdout?.on('data', onData);
      childProcess.stderr?.on('data', onData);
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    const client = createOpencodeClient({
      baseUrl,
    });

    const sessionCreateResult = await client.session.create({ body: {} });

    if (!sessionCreateResult.data?.id) {
      childProcess.kill();
      throw new Error('Failed to create session');
    }

    const sessionId = sessionCreateResult.data.id;

    const modelParts = model ? parseModelId(model) : undefined;
    // Combine system + user prompt into a single user-message text part, mirroring
    // OpenCodeAgentService (CLI) which concatenates them with `\n\n` and pipes via
    // stdin. Empirically, OpenCode's session.promptAsync sends an empty user-message
    // array to downstream providers (e.g. MiniMax → "messages must not be empty")
    // when the body uses a separate `system` field, so keep parity with the CLI.
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: DEFAULT_AGENT_NAME,
        parts: [{ type: 'text', text: combinedPrompt }],
        ...(modelParts ? { model: modelParts } : {}),
      },
    });

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

    // Forward serve logs to the daemon's stdout/stderr so they appear in pm2/journal
    // output alongside other harness logs (mirrors OpenCodeAgentService).
    childProcess.stdout?.pipe(process.stdout, { end: false });
    childProcess.stderr?.pipe(process.stderr, { end: false });

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
