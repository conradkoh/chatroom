/**
 * PiAgentService — concrete RemoteAgentService for the Pi CLI runtime.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Encapsulates all interactions with the `pi` CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   pi --mode rpc --session-dir <dir> [--session <id>] [--model <model>] [--system-prompt <systemPrompt>]
 *
 * The prompt is sent to the long-running process over stdin as a JSON command:
 *   {"type": "prompt", "message": "<prompt>"}
 *
 * Pi streams events back on stdout as newline-delimited JSON, parsed by PiRpcReader.
 * Text and thinking deltas are buffered per-line and emitted with [pi text] /
 * [pi thinking] prefixes so PM2 / daemon logs capture them as distinct log lines.
 * The process stays alive after each turn so future prompts can be sent over stdin.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import {
  BASH_TOOL_KIND,
  buildAgentLogPrefix,
  createAgentLogWriter,
  formatBashRunningPayload,
  resolveBashCommandForLog,
} from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type {
  DaemonHarnessSessionContext,
  HarnessReconnectMetadata,
  SpawnOptions,
  SpawnResult,
} from '../remote-agent-service.js';
import { PiRpcReader } from './pi-rpc-reader.js';

export type PiAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const PI_COMMAND = 'pi';
const PI_AGENT_NAME = 'pi';
const GET_STATE_TIMEOUT_MS = 5_000;
const SPAWN_READY_DELAY_MS = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPiSessionDir(workingDir: string): string {
  return join(workingDir, '.chatroom', 'pi-sessions');
}

interface PiTrackedSession {
  harnessSessionId: string;
  workingDir: string;
  model?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class PiAgentService extends BaseCLIAgentService {
  readonly id = 'pi';
  readonly displayName = 'Pi';
  readonly command = PI_COMMAND;

  /** Child processes by PID — needed for resumeTurn stdin writes. */
  private readonly childProcesses = new Map<number, ChildProcess>();
  /** Session metadata for daemon-memory stop→start resume reconnect context. */
  private readonly trackedSessions = new Map<number, PiTrackedSession>();

  constructor(deps?: Partial<PiAgentServiceDeps>) {
    super(deps);
  }

  override untrack(pid: number): void {
    this.childProcesses.delete(pid);
    this.trackedSessions.delete(pid);
    super.untrack(pid);
  }

  getHarnessReconnectContext(pid: number): HarnessReconnectMetadata | undefined {
    const session = this.trackedSessions.get(pid);
    if (!session) {
      return undefined;
    }
    return {
      agentName: PI_AGENT_NAME,
      ...(session.model ? { model: session.model } : {}),
    };
  }

  async resumeFromDaemonMemory(
    options: SpawnOptions,
    stored: DaemonHarnessSessionContext
  ): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;
    const modelForSession = model ?? stored.model;

    let childProcess: ChildProcess | undefined;
    try {
      childProcess = this.spawnPiRpcProcess({
        workingDir: stored.workingDir,
        systemPrompt,
        model: modelForSession,
        sessionId: stored.harnessSessionId,
      });

      await this.waitForSpawnReady(childProcess);
      await this.writePrompt(childProcess, prompt);

      return this.wireRpcProcess({
        childProcess,
        context,
        workingDir: stored.workingDir,
        model: modelForSession,
        harnessSessionId: stored.harnessSessionId,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${new Date().toISOString()}] role:${context.role} daemon-resume-fallback] ${reason} — cold spawning\n`
      );
      childProcess?.kill();
      return this.spawn(options);
    }
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const child = this.childProcesses.get(pid);
    if (!child) {
      throw new Error(`No tracked pi process or stdin for pid=${pid}`);
    }
    await this.writePrompt(child, prompt);
  }

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(PI_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(PI_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Use shell redirect `2>&1` to merge stderr into stdout so CLIs that
    // write output to stderr (e.g. Pi) are also captured.
    const output = await this.runListCommand('pi', `${PI_COMMAND} --list-models 2>&1`);

    if (output === null) return [];

    // Parse table output: first two columns are provider + model, joined as "provider/model".
    // Expected format (tab or whitespace separated):
    //   anthropic   claude-3-5-sonnet   ...
    const models: string[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const cols = trimmed.split(/\s+/);
      // Skip header row (first line: "provider  model  context  max-out  thinking  images")
      if (cols[0] === 'provider') continue;
      if (cols.length >= 2) {
        models.push(`${cols[0]}/${cols[1]}`);
      } else if (cols.length === 1 && cols[0]) {
        models.push(cols[0]);
      }
    }
    return models;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // The non-empty `prompt` invariant is enforced upstream by `createSpawnPrompt`
    // at the use-case layer (`agent-process-manager`). See
    // `infrastructure/services/remote-agents/spawn-prompt.ts`.
    const { prompt, systemPrompt, model, context, workingDir } = options;

    const childProcess = this.spawnPiRpcProcess({
      workingDir,
      systemPrompt,
      model,
    });

    await this.waitForSpawnReady(childProcess);

    if (!childProcess.stdout) {
      throw new Error('Pi RPC process has no stdout');
    }

    const reader = new PiRpcReader(childProcess.stdout);
    const harnessSessionId = await this.querySessionId(reader, childProcess.stdin);
    await this.writePrompt(childProcess, prompt);

    return this.wireRpcProcess({
      childProcess,
      context,
      workingDir,
      model,
      harnessSessionId,
      reader,
    });
  }

  private spawnPiRpcProcess(args: {
    workingDir: string;
    systemPrompt: string;
    model?: string;
    sessionId?: string;
  }): ChildProcess {
    const rpcArgs: string[] = ['--mode', 'rpc', '--session-dir', getPiSessionDir(args.workingDir)];

    if (args.sessionId) {
      rpcArgs.push('--session', args.sessionId);
    }

    if (args.model) {
      rpcArgs.push('--model', args.model);
    }

    if (args.systemPrompt) {
      rpcArgs.push('--system-prompt', args.systemPrompt);
    }

    const childProcess: ChildProcess = this.deps.spawn(PI_COMMAND, rpcArgs, {
      cwd: args.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
    });

    return childProcess;
  }

  private async waitForSpawnReady(childProcess: ChildProcess): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SPAWN_READY_DELAY_MS));

    if (childProcess.killed || childProcess.exitCode !== null) {
      throw new Error(`Agent process exited immediately (exit code: ${childProcess.exitCode})`);
    }

    if (!childProcess.pid) {
      throw new Error('Agent process started but has no PID');
    }
  }

  private writePrompt(child: ChildProcess, prompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!child.stdin) {
        reject(new Error('Pi RPC process has no stdin'));
        return;
      }
      const message = JSON.stringify({ type: 'prompt', message: prompt }) + '\n';
      child.stdin.write(message, (err) => (err ? reject(err) : resolve()));
    });
  }

  private async querySessionId(reader: PiRpcReader, stdin: ChildProcess['stdin']): Promise<string> {
    if (!stdin) {
      throw new Error('Pi RPC process has no stdin');
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`get_state timed out after ${GET_STATE_TIMEOUT_MS}ms`));
      }, GET_STATE_TIMEOUT_MS);

      reader.onStateResponse((sessionId) => {
        clearTimeout(timer);
        resolve(sessionId);
      });

      stdin.write(JSON.stringify({ type: 'get_state' }) + '\n');
    });
  }

  // fallow-ignore-next-line complexity
  private wireRpcProcess(args: {
    childProcess: ChildProcess;
    context: SpawnOptions['context'];
    workingDir: string;
    model?: string;
    harnessSessionId: string;
    reader?: PiRpcReader;
  }): SpawnResult {
    const { childProcess, context, workingDir, model, harnessSessionId } = args;
    const pid = childProcess.pid;
    if (pid == null) {
      throw new Error('Pi RPC process has no PID');
    }

    this.childProcesses.set(pid, childProcess);
    this.trackedSessions.set(pid, { harnessSessionId, workingDir, model });

    const entry = this.registerProcess(pid, context);

    const logPrefix = buildAgentLogPrefix('pi', context);

    const outputCallbacks: (() => void)[] = [];
    const logLineCallbacks: ((line: string) => void)[] = [];
    const agentEndCallbacks: (() => void)[] = [];

    const emitLogLine = (line: string) => {
      for (const cb of logLineCallbacks) cb(line);
    };

    const onExit = (
      cb: (info: {
        code: number | null;
        signal: string | null;
        context: SpawnOptions['context'];
      }) => void
    ) => {
      childProcess.on('exit', (code, signal) => {
        this.childProcesses.delete(pid);
        this.trackedSessions.delete(pid);
        this.deleteProcess(pid);
        cb({ code, signal, context });
      });
    };

    const onOutput = (cb: () => void) => {
      outputCallbacks.push(cb);
    };

    const onAgentEnd = (cb: () => void) => {
      agentEndCallbacks.push(cb);
    };

    const onLogLine = (cb: (line: string) => void) => {
      logLineCallbacks.push(cb);
    };

    const baseResult: SpawnResult = {
      pid,
      harnessSessionId,
      harnessReconnect: {
        agentName: PI_AGENT_NAME,
        ...(model ? { model } : {}),
      },
      onExit,
      onOutput,
      onLogLine,
    };

    const log = createAgentLogWriter(logPrefix, { emitLogLine });

    const onStderrData = (chunk: Buffer | string) => {
      entry.lastOutputAt = Date.now();
      for (const cb of outputCallbacks) cb();
      emitLogLine(chunk.toString());
    };

    const attachStderr = (stream: NodeJS.ReadableStream | null | undefined) => {
      if (!stream) return;
      stream.pipe(process.stderr, { end: false });
      stream.on('data', onStderrData);
    };

    if (!childProcess.stdout) {
      attachStderr(childProcess.stderr);
      return baseResult;
    }

    const reader = args.reader ?? new PiRpcReader(childProcess.stdout);

    let textBuffer = '';
    let thinkingBuffer = '';

    const flushBufferedLines = (buffer: string, kind: 'text' | 'thinking', clear: () => void) => {
      const remaining = log.flushBufferedLines(buffer, kind);
      clear();
      return remaining;
    };

    const flushText = () =>
      flushBufferedLines(textBuffer, 'text', () => {
        textBuffer = '';
      });

    const flushThinking = () =>
      flushBufferedLines(thinkingBuffer, 'thinking', () => {
        thinkingBuffer = '';
      });

    const notifyOutput = () => {
      entry.lastOutputAt = Date.now();
      for (const cb of outputCallbacks) cb();
    };

    reader.onTextDelta((delta) => {
      flushThinking();
      textBuffer += delta;
      if (textBuffer.includes('\n')) flushText();
      notifyOutput();
    });

    reader.onThinkingDelta((delta) => {
      flushText();
      thinkingBuffer += delta;
      if (thinkingBuffer.includes('\n')) flushThinking();
      notifyOutput();
    });

    reader.onAnyEvent(() => {
      notifyOutput();
    });

    reader.onAgentEnd(() => {
      flushText();
      flushThinking();
      log.write('agent_end');
      for (const cb of agentEndCallbacks) cb();
    });

    reader.onToolCall((name, toolArgs) => {
      flushText();
      flushThinking();
      const bashCmd = resolveBashCommandForLog(name, toolArgs);
      if (bashCmd !== null) {
        log.write(BASH_TOOL_KIND, formatBashRunningPayload(bashCmd));
        return;
      }
      const argsStr = toolArgs != null ? ` args: ${JSON.stringify(toolArgs)}` : '';
      log.write('tool', `${name}${argsStr}`);
    });

    reader.onToolResult((name, result) => {
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      log.write('tool_result', `${name} result: ${resultStr}`);
    });

    attachStderr(childProcess.stderr);

    return {
      ...baseResult,
      onAgentEnd,
    };
  }
}
