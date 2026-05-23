/**
 * CommandCodeAgentService — concrete RemoteAgentService for the CommandCode CLI.
 *
 * Spawns agents using:
 *   cmd -p --skip-onboarding --yolo [--model <provider/name>]
 *
 * The combined system prompt and user prompt are written to stdin (same pattern
 * as CursorAgentService). CommandCode headless print mode is single-shot: one
 * prompt → plain-text response on stdout → exit. The daemon's restart lifecycle
 * handles multi-turn by spawning a fresh process for each turn.
 *
 * Per https://commandcode.ai/docs/core-concepts/headless, `cmd -p` writes a
 * plain-text response to stdout (no stream-json protocol). CommandCodeStreamReader
 * accumulates lines and fires agentEnd on stream close.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { CommandCodeStreamReader } from './command-code-stream-reader.js';

export type CommandCodeAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const COMMANDCODE_COMMAND = 'cmd';

/**
 * Known CommandCode models.
 * Source of truth: https://commandcode.ai/docs/reference/cli/models
 */
const COMMANDCODE_MODELS: string[] = [
  // Anthropic Claude
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-haiku-4-5',
  // OpenAI
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.4-mini',
  // Google
  'google/gemini-3.5-flash',
  'google/gemini-3.1-flash-lite',
  // Moonshot
  'moonshotai/Kimi-K2.6',
  'moonshotai/Kimi-K2.5',
  // ZhipuAI
  'zai-org/GLM-5.1',
  'zai-org/GLM-5',
  // MiniMax
  'MiniMaxAI/MiniMax-M2.7',
  'MiniMaxAI/MiniMax-M2.5',
  // DeepSeek
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  // Qwen
  'Qwen/Qwen3.6-Max-Preview',
  'Qwen/Qwen3.6-Plus',
  'Qwen/Qwen3.7-Max',
  // StepFun
  'stepfun/Step-3.5-Flash',
];

// ─── Implementation ───────────────────────────────────────────────────────────

export class CommandCodeAgentService extends BaseCLIAgentService {
  readonly id = 'commandcode';
  readonly displayName = 'CommandCode';
  readonly command = COMMANDCODE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(COMMANDCODE_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(COMMANDCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    return COMMANDCODE_MODELS;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // --max-turns 100: the default of 10 is far too low for the chatroom workflow.
    // A single session needs ~2–20 turns: register-agent → get-next-task (blocking) →
    // task-read → work iterations → handoff. Raising the cap avoids premature exit-8
    // (cap-hit) which the daemon would classify as a crash and back off from.
    const args: string[] = ['-p', '--skip-onboarding', '--yolo', '--max-turns', '100'];
    if (options.model) {
      args.push('--model', options.model);
    }

    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.prompt}`
      : options.prompt;

    const childProcess: ChildProcess = this.deps.spawn(COMMANDCODE_COMMAND, args, {
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
    const logPrefix = `[commandcode:${roleTag}${chatroomSuffix}`;

    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CommandCodeStreamReader(childProcess.stdout);

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
