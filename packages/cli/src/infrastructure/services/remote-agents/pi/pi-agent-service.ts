/**
 * PiAgentService — concrete RemoteAgentService for the Pi CLI runtime.
 *
 * Encapsulates all interactions with the `pi` CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   pi -p --no-session --system-prompt "<systemPrompt>" "<prompt>"
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Shell-escape a string so it can be safely embedded in a shell argument.
 * Wraps the value in single quotes and escapes any embedded single quotes.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

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
    const { systemPrompt, prompt } = options;

    // Build command: pi -p --no-session --system-prompt '<systemPrompt>' '<prompt>'
    // We use shell: true so that the shell handles the quoted arguments correctly.
    const escapedSystemPrompt = shellEscape(systemPrompt);
    const escapedPrompt = shellEscape(prompt);
    const shellCmd = `${PI_COMMAND} -p --no-session --system-prompt ${escapedSystemPrompt} ${escapedPrompt}`;

    const childProcess: ChildProcess = this.deps.spawn(shellCmd, [], {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
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
