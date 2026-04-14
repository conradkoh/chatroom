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

export type CursorAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const CURSOR_COMMAND = 'agent';

const CURSOR_MODELS: string[] = [
  // Anthropic Claude
  'opus-4.6',
  'opus-4.6-thinking',
  'opus-4.5',
  'opus-4.5-thinking',
  'sonnet-4.6',
  'sonnet-4.6-thinking',
  'sonnet-4.5',
  'sonnet-4.5-thinking',
  // OpenAI GPT-5.4
  'gpt-5.4-low',
  'gpt-5.4-medium',
  'gpt-5.4-medium-fast',
  'gpt-5.4-high',
  'gpt-5.4-high-fast',
  'gpt-5.4-xhigh',
  'gpt-5.4-xhigh-fast',
  // OpenAI GPT-5.3 Codex
  'gpt-5.3-codex-low',
  'gpt-5.3-codex-low-fast',
  'gpt-5.3-codex',
  'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high',
  'gpt-5.3-codex-high-fast',
  'gpt-5.3-codex-xhigh',
  'gpt-5.3-codex-xhigh-fast',
  'gpt-5.3-codex-spark-preview',
  // OpenAI GPT-5.2
  'gpt-5.2',
  'gpt-5.2-high',
  'gpt-5.2-codex-low',
  'gpt-5.2-codex-low-fast',
  'gpt-5.2-codex',
  'gpt-5.2-codex-fast',
  'gpt-5.2-codex-high',
  'gpt-5.2-codex-high-fast',
  'gpt-5.2-codex-xhigh',
  'gpt-5.2-codex-xhigh-fast',
  // OpenAI GPT-5.1
  'gpt-5.1-high',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high',
  'gpt-5.1-codex-mini',
  // Google Gemini
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-flash',
  // Other
  'grok',
  'kimi-k2.5',
  // Cursor built-in
  'auto',
  'composer-2',
  'composer-1.5',
  'composer-1',
];

// ─── Implementation ──────────────────────────────────────────────────────────

export class CursorAgentService extends BaseCLIAgentService {
  readonly id = 'cursor';
  readonly displayName = 'Cursor';
  readonly command = CURSOR_COMMAND;

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
    return CURSOR_MODELS;
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
      env: {
        ...process.env,
        // Prevent git rebase/merge from opening an interactive editor
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
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
