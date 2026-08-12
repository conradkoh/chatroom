/**
 * CursorAgentService — concrete RemoteAgentService for the Cursor Agent CLI.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Spawns agents using:
 *   agent -p --force --output-format stream-json [--model <model>]
 *
 * The combined system prompt and user prompt are written to stdin (same as
 * OpenCode). Cursor print mode is single-shot: one prompt → one response → exit.
 * The daemon's restart lifecycle handles multi-turn by spawning a fresh process
 * for each turn (triggered by onAgentEnd → kill → agent:exited → respawn).
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { CursorStreamReader } from './cursor-stream-reader.js';
import {
  BASH_TOOL_KIND,
  buildAgentLogPrefix,
  extractBashCommandFromCursorToolCall,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { createSessionLogCallbacks } from '../session-log-callbacks.js';

export type CursorAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const CURSOR_COMMAND = 'agent';

const CURSOR_PROVIDER = 'cursor';

/**
 * Injected at the top of every system prompt to prevent the Cursor agent from
 * spawning internal subagents. Cursor's backend defaults to fast-routing and
 * may spawn subagents (explore, generalPurpose, etc.) which use a different
 * model and ignore the parent agent's instructions.
 */
const NO_SUBAGENT_DIRECTIVE = 'NEVER spawn subagents. Follow the chatroom instructions strictly.';

/** Strip `cursor/` prefix so the CLI receives a bare slug. Bare slugs pass through unchanged. */
export function resolveCursorCliModel(model: string): string {
  const prefix = `${CURSOR_PROVIDER}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class CursorAgentService extends BaseCLIAgentService {
  readonly id = 'cursor';
  readonly displayName = 'Cursor';
  readonly command = CURSOR_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(CURSOR_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(CURSOR_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Model list moved to the server catalog (api.harnesses.cursor.listModels).
    // The daemon overlays the catalog onto discovery at boot / manual refresh.
    return [];
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const args: string[] = ['-p', '--force', '--output-format', 'stream-json'];
    if (options.model) {
      args.push('--model', resolveCursorCliModel(options.model));
    }

    const systemPrompt = options.systemPrompt
      ? `${NO_SUBAGENT_DIRECTIVE}\n\n${options.systemPrompt}`
      : NO_SUBAGENT_DIRECTIVE;
    const fullPrompt = `${systemPrompt}\n\n${options.prompt}`;

    const childProcess: ChildProcess = this.deps.spawn(CURSOR_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: this.agentSpawnEnv(options.resolvedConvexUrl),
    });

    childProcess.stdin?.write(fullPrompt);
    childProcess.stdin?.end();

    const pid = await this.assertChildProcessStarted(childProcess);
    const context = options.context;

    const entry = this.registerProcess(pid, context);

    const logPrefix = buildAgentLogPrefix('cursor', context);
    const { onLogLine, emitFormatted } = createSessionLogCallbacks();

    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CursorStreamReader(childProcess.stdout);

      let textBuffer = '';
      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) emitFormatted(formatAgentLogLine(logPrefix, 'text', line));
        }
        textBuffer = '';
      };

      reader.onText((text) => {
        textBuffer += text;
        if (textBuffer.includes('\n')) flushText();
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAnyEvent(() => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAgentEnd(() => {
        flushText();
        emitFormatted(formatAgentLogLine(logPrefix, 'agent_end'));
      });

      reader.onToolCall((callId, toolCall) => {
        flushText();
        const bashCmd = extractBashCommandFromCursorToolCall(toolCall);
        if (bashCmd !== null) {
          emitFormatted(formatAgentLogLine(logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd)));
          return;
        }
        emitFormatted(formatAgentLogLine(logPrefix, 'tool', `${callId} ${JSON.stringify(toolCall)}`));
      });

      reader.onToolResult((callId) => {
        flushText();
        emitFormatted(formatAgentLogLine(logPrefix, 'tool_result', callId));
      });

      if (childProcess.stderr) {
        childProcess.stderr.on('data', (chunk: Buffer) => {
          emitFormatted(chunk.toString('utf8'), 'stderr');
          entry.lastOutputAt = Date.now();
          for (const cb of outputCallbacks) cb();
        });
      }

      return {
        pid,
        onExit: (cb) => {
          childProcess.on('exit', (code, signal) => {
            this.deleteProcess(pid);
            cb({ code, signal, context });
          });
        },
        onOutput: (cb) => {
          outputCallbacks.push(cb);
        },
        onAgentEnd: (cb) => {
          reader.onAgentEnd(cb);
        },
        onLogLine,
      };
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (chunk: Buffer) => {
        emitFormatted(chunk.toString('utf8'), 'stderr');
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }

    return {
      pid,
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          this.deleteProcess(pid);
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onLogLine,
    };
  }
}
