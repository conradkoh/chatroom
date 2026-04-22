/**
 * ProcessAgentDriver — abstract base class for process-based agent drivers.
 *
 * Centralizes child_process.spawn boilerplate (detached, stdio, env, etc.)
 * that was previously duplicated across BaseCLIAgentService and concrete
 * service implementations.
 *
 * Subclasses implement buildArgs() and provide their harness identifier and
 * capabilities. The base class handles:
 * - Spawning with standard options (detached, shell: false, stdio: pipe)
 * - Writing the combined prompt to stdin
 * - Crash detection (immediate exit after spawn)
 * - Process lifecycle (stop via SIGTERM → SIGKILL, isAlive via kill(0))
 */

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  AgentCapabilities,
  AgentHandle,
  AgentStartOptions,
  AgentToolDriver,
  AgentHarness,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const KILL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;
const CRASH_DETECTION_DELAY_MS = 500;

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface ProcessDriverDeps {
  spawn: typeof spawn;
  kill: (pid: number, signal: number | string) => boolean;
}

function defaultDeps(): ProcessDriverDeps {
  return {
    spawn,
    kill: (pid, signal) => process.kill(pid, signal),
  };
}

// ─── Abstract Base ────────────────────────────────────────────────────────────

export abstract class ProcessAgentDriver implements AgentToolDriver {
  protected readonly deps: ProcessDriverDeps;

  constructor(deps?: Partial<ProcessDriverDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  abstract readonly harness: AgentHarness;
  abstract readonly capabilities: AgentCapabilities;

  /** The CLI command to invoke (e.g. 'opencode', 'cursor') */
  protected abstract readonly command: string;

  /**
   * Build the CLI args array for the given start options.
   * Does NOT include the command itself.
   */
  protected abstract buildArgs(options: AgentStartOptions): string[];

  /**
   * Build the full prompt string to write to stdin.
   * Default: combines rolePrompt and initialMessage.
   * Subclasses may override to change the format.
   */
  protected buildPrompt(options: AgentStartOptions): string {
    return options.rolePrompt
      ? `${options.rolePrompt}\n\n${options.initialMessage}`
      : options.initialMessage;
  }

  async start(options: AgentStartOptions): Promise<AgentHandle> {
    const args = this.buildArgs(options);
    const prompt = this.buildPrompt(options);

    const childProcess: ChildProcess = this.deps.spawn(this.command, args, {
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

    // Write prompt to stdin
    childProcess.stdin?.write(prompt);
    childProcess.stdin?.end();

    // Pipe output to parent process stdout/stderr for visibility
    if (childProcess.stdout) {
      childProcess.stdout.pipe(process.stdout, { end: false });
    }
    if (childProcess.stderr) {
      childProcess.stderr.pipe(process.stderr, { end: false });
    }

    // Wait briefly for immediate crash detection
    await new Promise((resolve) => setTimeout(resolve, CRASH_DETECTION_DELAY_MS));

    if (childProcess.killed || childProcess.exitCode !== null) {
      throw new Error(`Agent process exited immediately (exit code: ${childProcess.exitCode})`);
    }

    if (!childProcess.pid) {
      throw new Error('Agent process started but has no PID');
    }

    return {
      harness: this.harness,
      type: 'process',
      pid: childProcess.pid,
      workingDir: options.workingDir,
    };
  }

  async stop(handle: AgentHandle): Promise<void> {
    const pid = handle.pid;
    if (!pid) return;

    // SIGTERM → entire process group (negative PID)
    try {
      this.deps.kill(-pid, 'SIGTERM');
    } catch {
      return; // Already dead
    }

    const deadline = Date.now() + KILL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        this.deps.kill(pid, 0);
      } catch {
        return; // Exited
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Still alive — escalate to SIGKILL
    try {
      this.deps.kill(-pid, 'SIGKILL');
    } catch {
      // May have exited between check and kill
    }
  }

  isAlive(handle: AgentHandle): boolean {
    const pid = handle.pid;
    if (!pid) return false;
    try {
      this.deps.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}
