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
import type { ChildProcess, ExecSyncOptions } from 'node:child_process';

import { Effect, Schedule, Duration } from 'effect';

import { DetectionResult, isInstalled, DETECTION_RETRY_POLICY } from './detection-result.js';
import type {
  AgentStopOptions,
  RemoteAgentService,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  ProcessInfo,
  VersionInfo,
} from './remote-agent-service.js';
import { buildAgentSpawnEnv } from '../../convex/spawn-env.js';

// ─── Error Classification ─────────────────────────────────────────────────────

interface ExecSyncError extends Error {
  status?: number;
  stderr?: Buffer | string;
  stdout?: Buffer | string;
  signal?: string;
}

function isExecSyncError(error: unknown): error is ExecSyncError {
  return error instanceof Error && ('status' in error || 'stderr' in error || 'signal' in error);
}

function isStderrEmpty(stderr: Buffer | string | undefined): boolean {
  if (!stderr) return true;
  const str = Buffer.isBuffer(stderr) ? stderr.toString() : stderr;
  return str.trim().length === 0;
}

// ─── Transient Error Type ─────────────────────────────────────────────────────

/**
 * Transient error type — only these get retried.
 * Module-scoped so it isn't recreated per call.
 */
class TransientDetectionError {
  readonly _tag = 'TransientDetectionError' as const;
  constructor(readonly reason: string) {}
}

// ─── Command Outcome ──────────────────────────────────────────────────────────

/**
 * Discriminated union for the result of running a command with retry.
 * Internal type — not exported from the package index.
 */
type CommandOutcome =
  | { readonly _tag: 'Output'; readonly stdout: string }
  | { readonly _tag: 'NotInstalled' }
  | { readonly _tag: 'Failure'; readonly reason: string; readonly attempts: number };

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface CLIAgentServiceDeps {
  /** Execute a synchronous command (for detection/version/model queries). */
  execSync: typeof execSync;
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
const SPAWN_READY_DELAY_MS = 500;

// ─── Retry Schedule ───────────────────────────────────────────────────────────

const retrySchedule = Schedule.exponential(
  Duration.millis(DETECTION_RETRY_POLICY.initialDelayMs),
  DETECTION_RETRY_POLICY.backoffFactor
).pipe(
  Schedule.either(Schedule.spaced(Duration.millis(DETECTION_RETRY_POLICY.maxDelayMs))),
  Schedule.compose(Schedule.recurs(DETECTION_RETRY_POLICY.maxAttempts - 1))
);

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
   *
   * @see checkInstalledDetailedEffect for the underlying Effect program.
   */
  protected checkInstalled(command: string): Promise<boolean> {
    return Effect.runPromise(
      this.checkInstalledDetailedEffect(command).pipe(Effect.map(isInstalled))
    );
  }

  /**
   * Run a shell command with exponential-backoff retry and classification.
   *
   * Returns an Effect program (not run) that:
   * - Executes the command via execSync
   * - Classifies failures as terminal (NotInstalled) or transient (retryable)
   * - Retries transient failures with exponential backoff
   * - Maps exhausted retries to Failure
   *
   * The returned Effect has error channel `never` — it always succeeds with
   * a CommandOutcome so callers can safely use Effect.runPromise.
   */
  protected runCommandWithRetryEffect(
    command: string,
    options: {
      stdio?: ExecSyncOptions['stdio'];
      timeout?: number;
      classifyNotInstalled?: (err: unknown) => boolean;
    } = {}
  ): Effect.Effect<CommandOutcome, never> {
    const {
      stdio = ['pipe', 'pipe', 'pipe'],
      timeout,
      classifyNotInstalled = () => false,
    } = options;
    const deps = this.deps;
    let attempts = 0;

    // Detection effect: classify execSync outcome into success (terminal) or transient failure
    const detection: Effect.Effect<CommandOutcome, TransientDetectionError> = Effect.suspend(
      (): Effect.Effect<CommandOutcome, TransientDetectionError> => {
        attempts++;
        try {
          const buffer = deps.execSync(command, {
            stdio,
            ...(timeout !== undefined ? { timeout } : {}),
          });
          return Effect.succeed({ _tag: 'Output', stdout: buffer ? buffer.toString() : '' });
        } catch (error: unknown) {
          // Terminal classification — caller decides what "not installed" means
          if (classifyNotInstalled(error)) {
            return Effect.succeed({ _tag: 'NotInstalled' });
          }
          // All other failures are transient (retryable)
          const reason = error instanceof Error ? error.message : String(error);
          return Effect.fail(new TransientDetectionError(reason));
        }
      }
    );

    // Run with retry, then map remaining failure to Failure
    const program = detection.pipe(
      Effect.retry(retrySchedule),
      Effect.catchAll((err: TransientDetectionError) =>
        Effect.succeed({ _tag: 'Failure' as const, reason: err.reason, attempts })
      )
    );

    return program;
  }

  /**
   * Effect-native tri-state detection of CLI command availability.
   *
   * Returns an Effect program (not run) that:
   * - Classifies execSync outcome into success (terminal) or transient failure
   * - Retries transient failures with exponential backoff
   * - Maps exhausted retries to DetectionError
   *
   * The returned Effect has error channel `never` — it always succeeds with
   * a DetectionResult so callers can safely use Effect.runPromise.
   */
  protected checkInstalledDetailedEffect(command: string): Effect.Effect<DetectionResult, never> {
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;

    return this.runCommandWithRetryEffect(checkCmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      classifyNotInstalled: (error) =>
        isExecSyncError(error) && error.status === 1 && isStderrEmpty(error.stderr),
    }).pipe(
      Effect.map((outcome) => {
        switch (outcome._tag) {
          case 'Output':
            return DetectionResult.Installed();
          case 'NotInstalled':
            return DetectionResult.NotInstalled();
          case 'Failure':
            return DetectionResult.DetectionError(outcome.reason, outcome.attempts);
        }
      })
    );
  }

  /**
   * Returns the version of the given CLI command, parsed as semver.
   * Runs `<command> --version` and extracts a `major.minor.patch` triple.
   * Returns null if not installed or version cannot be parsed.
   *
   * Subclasses implement the no-arg `getVersion()` from RemoteAgentService
   * by calling this with their specific command name.
   */
  protected async checkVersion(command: string): Promise<VersionInfo | null> {
    const outcome = await Effect.runPromise(
      this.runCommandWithRetryEffect(`${command} --version 2>&1`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })
    );

    if (outcome._tag !== 'Output') return null;

    const output = outcome.stdout.trim();
    const match = output.match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;

    return {
      version: `${match[1]}.${match[2]}.${match[3]}`,
      major: parseInt(match[1], 10),
    };
  }

  /**
   * Runs a `list models` style command with retry and structured warning on
   * exhausted retries.
   */
  protected async runListCommand(
    harnessName: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<string | null> {
    const outcome = await Effect.runPromise(
      this.runCommandWithRetryEffect(command, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options?.timeout ?? 10000,
      })
    );

    if (outcome._tag === 'Output') {
      return outcome.stdout.trim();
    }

    if (outcome._tag === 'Failure') {
      console.warn(
        JSON.stringify({
          event: 'list-models-error',
          harness: harnessName,
          reason: outcome.reason,
          attempts: outcome.attempts,
        })
      );
    }

    return null;
  }

  /**
   * Stop a spawned agent process. Sends SIGTERM to the entire process group,
   * polls until the process exits, then escalates to SIGKILL if it lingers.
   */
  async stop(pid: number, _options?: AgentStopOptions): Promise<void> {
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

  protected agentSpawnEnv(resolvedConvexUrl: string): NodeJS.ProcessEnv {
    return buildAgentSpawnEnv(resolvedConvexUrl);
  }

  protected async assertChildProcessStarted(childProcess: ChildProcess): Promise<number> {
    await new Promise((resolve) => setTimeout(resolve, SPAWN_READY_DELAY_MS));
    if (childProcess.killed || childProcess.exitCode !== null) {
      throw new Error(`Agent process exited immediately (exit code: ${childProcess.exitCode})`);
    }
    if (!childProcess.pid) {
      throw new Error('Agent process started but has no PID');
    }
    return childProcess.pid;
  }

  // ─── Abstract properties & methods (subclasses must implement) ──────────────

  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly command: string;

  abstract isInstalled(): Promise<boolean>;
  abstract getVersion(): Promise<VersionInfo | null>;
  abstract listModels(): Promise<string[]>;
  abstract spawn(options: SpawnOptions): Promise<SpawnResult>;

  /**
   * Effect-native tri-state detection of the configured CLI command.
   *
   * Returns an Effect program (not run) that can be composed into larger
   * Effect pipelines, e.g. `Effect.forEach` for parallel detection.
   */
  public detectInstallationEffect(): Effect.Effect<DetectionResult, never> {
    return this.checkInstalledDetailedEffect(this.command);
  }

  /**
   * Tri-state detection of the configured CLI command.
   *
   * Returns `Installed`, `NotInstalled` (terminal), or `DetectionError` (retryable).
   * @see checkInstalledDetailedEffect for the underlying Effect program.
   */
  public detectInstallation(): Promise<DetectionResult> {
    return Effect.runPromise(this.checkInstalledDetailedEffect(this.command));
  }
}
