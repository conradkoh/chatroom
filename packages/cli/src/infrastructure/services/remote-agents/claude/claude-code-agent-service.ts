/**
 * ClaudeCodeAgentService — concrete RemoteAgentService for the Claude Code CLI runtime.
 *
 * Encapsulates all interactions with Claude Code: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   claude -p --model <model> --system-prompt <systemPrompt> --max-turns 200 <prompt>
 *
 * Claude Code runs in "print mode" (-p) which processes the prompt and exits.
 * The prompt is passed as a positional argument and the system prompt via --system-prompt.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';

export type ClaudeCodeAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_COMMAND = 'claude';

/**
 * Default max turns for Claude Code agentic mode.
 * Each "turn" is one model response → tool use → model response cycle.
 * 200 turns gives the agent plenty of room for complex tasks.
 */
const DEFAULT_MAX_TURNS = 200;

// ─── Implementation ──────────────────────────────────────────────────────────

export class ClaudeCodeAgentService extends BaseCLIAgentService {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly command = CLAUDE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  isInstalled(): boolean {
    return this.checkInstalled(CLAUDE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(CLAUDE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Claude Code doesn't have a built-in model listing command.
    // Return the known supported models.
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ];
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { systemPrompt, model, prompt } = options;

    // Build args for print mode (-p): non-interactive, processes prompt and exits.
    const args: string[] = ['-p'];

    // Set max turns for agentic operation
    args.push('--max-turns', String(DEFAULT_MAX_TURNS));

    if (model) {
      args.push('--model', model);
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // The prompt is passed as a positional argument
    args.push(prompt);

    const childProcess: ChildProcess = this.deps.spawn(CLAUDE_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
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

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];
    if (childProcess.stdout) {
      childProcess.stdout.pipe(process.stdout, { end: false });
      childProcess.stdout.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
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
