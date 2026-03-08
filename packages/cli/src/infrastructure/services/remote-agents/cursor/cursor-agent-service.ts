/**
 * CursorAgentService — concrete RemoteAgentService for the Cursor Agent CLI.
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

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { CursorStreamReader } from './cursor-stream-reader.js';

// ─── Re-export deps type under the legacy name for backwards compatibility ────

export type CursorAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const CURSOR_COMMAND = 'agent';

// ─── Implementation ──────────────────────────────────────────────────────────

export class CursorAgentService extends BaseCLIAgentService {
  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  isInstalled(): boolean {
    return this.checkInstalled(CURSOR_COMMAND);
  }

  getVersion() {
    return this.checkVersion(CURSOR_COMMAND);
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const args: string[] = ['-p', '--force', '--output-format', 'stream-json'];
    if (options.model) {
      args.push('--model', options.model);
    }

    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.prompt}`
      : options.prompt;

    const childProcess: ChildProcess = this.deps.spawn(CURSOR_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: { ...process.env },
    });

    childProcess.stdin?.write(fullPrompt);
    childProcess.stdin?.end();

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (childProcess.killed || childProcess.exitCode !== null) {
      throw new Error(`Agent process exited immediately (exit code: ${childProcess.exitCode})`);
    }

    if (!childProcess.pid) {
      throw new Error('Agent process started but has no PID');
    }

    const pid = childProcess.pid;
    const context = options.context;

    const entry = this.registerProcess(pid, context);

    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
    const logPrefix = `[cursor:${roleTag}${chatroomSuffix}`;

    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CursorStreamReader(childProcess.stdout);

      let textBuffer = '';
      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) process.stdout.write(`${logPrefix} text] ${line}\n`);
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
        process.stdout.write(`${logPrefix} agent_end]\n`);
      });

      reader.onToolCall((callId, toolCall) => {
        flushText();
        process.stdout.write(`${logPrefix} tool: ${callId} ${JSON.stringify(toolCall)}]\n`);
      });

      reader.onToolResult((callId) => {
        flushText();
        process.stdout.write(`${logPrefix} tool_result: ${callId}]\n`);
      });

      if (childProcess.stderr) {
        childProcess.stderr.pipe(process.stderr, { end: false });
        childProcess.stderr.on('data', () => {
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
      };
    }

    if (childProcess.stderr) {
      childProcess.stderr.pipe(process.stderr, { end: false });
      childProcess.stderr.on('data', () => {
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
    };
  }
}
