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

import {
  BASH_TOOL_KIND,
  buildAgentLogPrefix,
  extractBashCommandFromCursorToolCall,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { CursorStreamReader } from './cursor-stream-reader.js';

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

const CURSOR_MODELS: string[] = [
  // Anthropic Claude
  'claude-4.6-opus-high',
  'claude-4.6-opus-high-thinking',
  'claude-4.6-opus-max',
  'claude-4.6-opus-max-thinking',
  'claude-4.5-opus-high',
  'claude-4.5-opus-high-thinking',
  'claude-4.6-sonnet-medium',
  'claude-4.6-sonnet-medium-thinking',
  'claude-4.5-sonnet',
  'claude-4.5-sonnet-thinking',
  'claude-4-sonnet',
  'claude-4-sonnet-thinking',
  'claude-4-sonnet-1m',
  'claude-4-sonnet-1m-thinking',
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
  'composer-2.5',
  'composer-2',
  'composer-1.5',
  'composer-1',
];

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
    return CURSOR_MODELS;
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

    const logPrefix = buildAgentLogPrefix('cursor', context);

    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CursorStreamReader(childProcess.stdout);

      let textBuffer = '';
      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) process.stdout.write(`${formatAgentLogLine(logPrefix, 'text', line)}\n`);
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
        process.stdout.write(`${formatAgentLogLine(logPrefix, 'agent_end')}\n`);
      });

      reader.onToolCall((callId, toolCall) => {
        flushText();
        const bashCmd = extractBashCommandFromCursorToolCall(toolCall);
        if (bashCmd !== null) {
          process.stdout.write(
            `${formatAgentLogLine(logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd))}\n`
          );
          return;
        }
        process.stdout.write(
          `${formatAgentLogLine(logPrefix, 'tool', `${callId} ${JSON.stringify(toolCall)}`)}\n`
        );
      });

      reader.onToolResult((callId) => {
        flushText();
        process.stdout.write(`${formatAgentLogLine(logPrefix, 'tool_result', callId)}\n`);
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
