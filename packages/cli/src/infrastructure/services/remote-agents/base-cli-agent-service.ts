/**
 * BaseCLIAgentService — abstract base class for CLI-based remote agent services.
 *
 * Provides shared boilerplate for all CLI agent implementations:
 * - Dependency injection (execSync, spawn, kill)
 * - Process registry tracking spawned PIDs with context and last-output timestamps
 * - isInstalled / getVersion (command passed per-call)
 * - stop / isAlive / getTrackedProcesses / untrack (identical lifecycle across all agents)
 *
 * Subclasses must implement:
 * - listModels(): Promise<string[]>
 * - spawn(options: SpawnOptions): Promise<SpawnResult>
 */

import { spawn, execSync } from 'node:child_process';

import type {
  RemoteAgentService,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  ProcessInfo,
  VersionInfo,
} from './remote-agent-service.js';

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface CLIAgentServiceDeps {
  /** Execute a synchronous command (for detection/version/model queries). */
  execSync: (cmd: string, options?: object) => Buffer;
  /** Spawn a child process (for agent lifecycle). */
  spawn: typeof spawn;
  /** Send a signal to a PID. Throws if process does not exist. */
  kill: (pid: number, signal: number | string) => boolean;
}

function defaultDeps(): CLIAgentServiceDeps {
  return {
    execSync,
    spawn,
    kill: (pid, signal) => process.kill(pid, signal),
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KILL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

// ─── Base Class ───────────────────────────────────────────────────────────────

export abstract class BaseCLIAgentService implements RemoteAgentService {
  protected readonly deps: CLIAgentServiceDeps;
  private readonly processes = new Map<number, { context: SpawnContext; lastOutputAt: number }>();

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  /**
   * Returns true if the given CLI command is available on this machine.
   * Uses `which` (Unix) or `where` (Windows) to check.
   *
   * Subclasses implement the no-arg `isInstalled()` from RemoteAgentService
   * by calling this with their specific command name.
   */
  protected checkInstalled(command: string): boolean {
    try {
      const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
      this.deps.execSync(checkCmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the version of the given CLI command, parsed as semver.
   * Runs `<command> --version` and extracts a `major.minor.patch` triple.
   * Returns null if not installed or version cannot be parsed.
   *
   * Subclasses implement the no-arg `getVersion()` from RemoteAgentService
   * by calling this with their specific command name.
   */
  protected checkVersion(command: string): VersionInfo | null {
    try {
      // Use shell redirect `2>&1` to merge stderr into stdout so CLIs that
      // write version info to stderr (e.g. Pi) are also captured.
      const output = this.deps
        .execSync(`${command} --version 2>&1`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        })
        .toString()
        .trim();

      const match = output.match(/v?(\d+)\.(\d+)\.(\d+)/);
      if (!match) return null;

      return {
        version: `${match[1]}.${match[2]}.${match[3]}`,
        major: parseInt(match[1], 10),
      };
    } catch {
      return null;
    }
  }

  /**
   * Stop a spawned agent process. Sends SIGTERM to the entire process group,
   * polls until the process exits, then escalates to SIGKILL if it lingers.
   */
  async stop(pid: number): Promise<void> {
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

    // Still alive — SIGKILL
    try {
      this.deps.kill(-pid, 'SIGKILL');
    } catch {
      // May have exited between check and kill
    }
  }

  /** Returns true if the given PID is still alive. */
  isAlive(pid: number): boolean {
    try {
      this.deps.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Returns all currently tracked processes with their context and last output timestamp. */
  getTrackedProcesses(): ProcessInfo[] {
    return Array.from(this.processes.entries()).map(([pid, entry]) => ({
      pid,
      context: entry.context,
      lastOutputAt: entry.lastOutputAt,
    }));
  }

  /** Remove a process from the internal registry (call on cleanup/exit). */
  untrack(pid: number): void {
    this.processes.delete(pid);
  }

  /**
   * Add a process to the internal registry.
   * Returns a reference to the registry entry so callers can update `lastOutputAt`.
   */
  protected registerProcess(
    pid: number,
    context: SpawnContext
  ): { context: SpawnContext; lastOutputAt: number } {
    const entry = { context, lastOutputAt: Date.now() };
    this.processes.set(pid, entry);
    return entry;
  }

  /**
   * Remove a process from the internal registry.
   * Equivalent to `untrack()` but intended for internal use by subclasses.
   */
  protected deleteProcess(pid: number): void {
    this.processes.delete(pid);
  }

  // ─── Abstract properties & methods (subclasses must implement) ──────────────

  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly command: string;

  abstract isInstalled(): boolean;
  abstract getVersion(): VersionInfo | null;
  abstract listModels(): Promise<string[]>;
  abstract spawn(options: SpawnOptions): Promise<SpawnResult>;
}
