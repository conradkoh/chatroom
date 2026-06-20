/**
 * CommandCodeAgentService — concrete RemoteAgentService for the CommandCode CLI.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
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
import type { SpawnContext, SpawnOptions, SpawnResult } from '../remote-agent-service.js';
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

  /**
   * Registers exit handling synchronously so short-lived `cmd -p` processes that
   * exit before the consumer calls onExit() still deliver callbacks (Node does
   * not replay late 'exit' listeners).
   */
  private createExitSubscription(
    childProcess: ChildProcess,
    pid: number,
    context: SpawnContext
  ): SpawnResult['onExit'] {
    let exitInfo: { code: number | null; signal: string | null } | null = null;
    const exitCallbacks: ((exit: {
      code: number | null;
      signal: string | null;
      context: SpawnContext;
    }) => void)[] = [];

    childProcess.on('exit', (code, signal) => {
      this.deleteProcess(pid);
      exitInfo = { code, signal };
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    });

    return (cb) => {
      if (exitInfo) {
        cb({ ...exitInfo, context });
      } else {
        exitCallbacks.push(cb);
      }
    };
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // NOTE: Tool-call logging to the daemon is currently UNSUPPORTED for commandcode.
    // `cmd -p` has no structured output / verbose / stream-events flag — only the final
    // model text reaches stdout. The only documented way to surface tool calls is via
    // `.commandcode/settings.json` hooks (https://commandcode.ai/docs/hooks), but that
    // requires writing config files into the agent's working directory (a stateful
    // change on the user's machine), which we explicitly do not want. So tool calls
    // run inside `cmd` are invisible to the daemon log channel; only the final response
    // text is forwarded. Revisit if `cmd` adds a `--output-format json` or similar.
    //
    // --max-turns 999999: the default of 10 is far too low for the chatroom workflow.
    // A single session may run many turns: register-agent → get-next-task (blocking) →
    // task-read → work iterations → handoff. Effectively uncap turns so the cmd
    // process never exits prematurely with exit-8 (which the daemon classifies as a crash).
    const args: string[] = ['-p', '--skip-onboarding', '--yolo', '--max-turns', '999999'];
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
      env: this.agentSpawnEnv(options.resolvedConvexUrl),
    });

    childProcess.stdin?.write(fullPrompt);
    childProcess.stdin?.end();

    const pid = await this.assertChildProcessStarted(childProcess);
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

      const onExit = this.createExitSubscription(childProcess, pid, context);

      return {
        pid,
        onExit,
        onOutput: (cb) => {
          outputCallbacks.push(cb);
        },
        onAgentEnd: (cb) => {
          reader.onAgentEnd(cb);
        },
      };
    }

    const onExit = this.createExitSubscription(childProcess, pid, context);

    if (childProcess.stderr) {
      childProcess.stderr.pipe(process.stderr, { end: false });
      childProcess.stderr.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }

    return {
      pid,
      onExit,
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
    };
  }
}
