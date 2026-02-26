/**
 * PiAgentService — concrete RemoteAgentService for the Pi CLI runtime.
 *
 * Encapsulates all interactions with the `pi` CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   pi -p --no-session [--model <model>] [--system-prompt <systemPrompt>] <prompt>
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';

// ─── Re-export deps type under the legacy name for backwards compatibility ────

export type PiAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const PI_COMMAND = 'pi';

/**
 * Default trigger message used when the caller provides no prompt.
 *
 * Pi requires at least one user message to call the AI API. When the init
 * prompt is empty (e.g. composeInitMessage returns ''), we send this trigger
 * so Pi can read the system prompt and execute the Getting Started steps.
 */
const DEFAULT_TRIGGER_PROMPT =
  'Please read your system prompt carefully and follow the Getting Started instructions.';

// ─── Implementation ──────────────────────────────────────────────────────────

export class PiAgentService extends BaseCLIAgentService {
  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  isInstalled(): boolean {
    return this.checkInstalled(PI_COMMAND);
  }

  getVersion() {
    return this.checkVersion(PI_COMMAND);
  }

  async listModels(): Promise<string[]> {
    try {
      const output = this.deps
        .execSync(`${PI_COMMAND} --list-models`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })
        .toString()
        .trim();

      if (!output) return [];

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
    } catch {
      return [];
    }
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { systemPrompt, model } = options;

    // Pi requires at least one user message — fall back to a default trigger when
    // the caller passes an empty prompt (e.g. composeInitMessage returns '').
    const prompt = options.prompt?.trim() ? options.prompt : DEFAULT_TRIGGER_PROMPT;

    // Build args array — prefer passing args directly (shell: false) so we don't
    // need to shell-escape anything and avoid the stdin-blocking issue that occurs
    // when shell: true wraps pi in /bin/sh.
    //
    // pi takes the prompt as a positional argument and ignores stdin, but it still
    // blocks waiting for stdin to close when stdio is piped. We close stdin immediately
    // after spawn (see below) to unblock it.
    const args: string[] = ['-p', '--no-session'];

    if (model) {
      args.push('--model', model);
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Prompt is the positional argument (last)
    args.push(prompt);

    const childProcess: ChildProcess = this.deps.spawn(PI_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });

    // pi doesn't read from stdin (prompt is a CLI arg), but it blocks waiting
    // for stdin to close when stdio is piped. End stdin immediately to unblock.
    childProcess.stdin?.end();

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
