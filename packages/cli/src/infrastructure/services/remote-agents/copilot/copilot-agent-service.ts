/**
 * CopilotAgentService — concrete RemoteAgentService for GitHub Copilot CLI.
 *
 * Encapsulates all interactions with GitHub Copilot CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * The GitHub Copilot CLI is invoked using the `copilot` command directly.
 * This is a standalone binary, not a gh extension.
 *
 * Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { CopilotStreamReader } from './copilot-stream-reader.js';

export type CopilotAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const COPILOT_COMMAND = 'copilot';

/**
 * Default trigger message used when the caller provides no prompt.
 * Copilot requires a non-empty prompt argument.
 */
const DEFAULT_TRIGGER_PROMPT =
  'Please read your system prompt carefully and follow the Getting Started instructions.';

// ─── Implementation ──────────────────────────────────────────────────────────

export class CopilotAgentService extends BaseCLIAgentService {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly command = COPILOT_COMMAND;

  constructor(deps?: Partial<CopilotAgentServiceDeps>) {
    super(deps);
  }

  isInstalled(): boolean {
    // Check if copilot binary is installed
    return this.checkInstalled(COPILOT_COMMAND);
  }

  getVersion() {
    // Check version using copilot --version
    return this.checkVersion(COPILOT_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // GitHub Copilot CLI uses models configured via GitHub settings
    // and doesn't expose a models list command.
    // Return known supported models from the CLI.
    return [
      // Anthropic Claude models
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-haiku-4.5',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      // OpenAI models
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      // Google models
      'gemini-3-pro-preview',
      'gemini-2-5-flash',
    ];
  }

  /**
   * Spawn a GitHub Copilot CLI agent.
   *
   * Command structure:
   *   copilot -p [--model <model>] [--allow-all] [--stream on] <prompt>
   *
   * The Copilot CLI processes the prompt and exits (single-shot mode).
   * The daemon's restart lifecycle handles multi-turn by spawning a fresh process
   * for each turn.
   *
   * Output format (plain text):
   *   ● Action description
   *   $ command to execute
   *   └ output
   */
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // Copilot requires a non-empty prompt
    const prompt = options.prompt?.trim() ? options.prompt : DEFAULT_TRIGGER_PROMPT;

    // Build command arguments for non-interactive prompt mode
    const args: string[] = ['-p'];

    // Enable streaming for real-time output
    args.push('--stream', 'on');

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    // Allow all tools automatically (required for non-interactive mode)
    args.push('--allow-all');

    // Add the prompt as the final argument
    args.push(prompt);

    const childProcess: ChildProcess = this.deps.spawn(COPILOT_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: {
        ...process.env,
        ...options.env,
        // Prevent git rebase/merge from opening an interactive editor
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
    });

    // Wait briefly for immediate crash detection
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (childProcess.killed || childProcess.exitCode !== null) {
      throw new Error(`Agent process exited immediately (exit code: ${childProcess.exitCode})`);
    }

    if (!childProcess.pid) {
      throw new Error('Agent process started but has no PID');
    }

    const pid = childProcess.pid;
    const context = options.context;

    // Register in process registry
    const entry = this.registerProcess(pid, context);

    // Build a log prefix from spawn context for easier debugging.
    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
    const logPrefix = `[copilot:${roleTag}${chatroomSuffix}]`;

    // Output tracking callbacks
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CopilotStreamReader(childProcess.stdout);

      // Handle text output
      reader.onText((text) => {
        process.stdout.write(`${logPrefix} ${text}\n`);
      });

      // Handle any event (for activity tracking)
      reader.onAnyEvent(() => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      // Handle agent end
      reader.onAgentEnd(() => {
        process.stdout.write(`${logPrefix} agent_end\n`);
      });
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
