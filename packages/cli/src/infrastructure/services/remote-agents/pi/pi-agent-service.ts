/**
 * PiAgentService — concrete RemoteAgentService for the Pi CLI runtime.
 *
 * Encapsulates all interactions with the `pi` CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   pi -p --no-session --system-prompt "<systemPrompt>" "<prompt>"
 *
 * Maintains an internal process registry that tracks spawned PIDs, their
 * associated context (machineId, chatroomId, role), and last output timestamps
 * for idle detection.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';

import type {
  RemoteAgentService,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  ProcessInfo,
  VersionInfo,
} from '../remote-agent-service.js';

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface PiAgentServiceDeps {
  /** Execute a synchronous command (for detection/version/model queries). */
  execSync: (cmd: string, options?: object) => Buffer;
  /** Spawn a child process (for agent lifecycle). */
  spawn: typeof spawn;
  /** Check if a PID is alive. Throws if dead. */
  kill: (pid: number, signal: number | string) => boolean;
}

function defaultDeps(): PiAgentServiceDeps {
  return {
    execSync,
    spawn,
    kill: (pid, signal) => process.kill(pid, signal),
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PI_COMMAND = 'pi';
const KILL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Shell-escape a string so it can be safely embedded in a shell argument.
 * Wraps the value in single quotes and escapes any embedded single quotes.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class PiAgentService implements RemoteAgentService {
  private readonly deps: PiAgentServiceDeps;
  private readonly processes = new Map<number, { context: SpawnContext; lastOutputAt: number }>();

  constructor(deps?: Partial<PiAgentServiceDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  isInstalled(): boolean {
    try {
      const checkCmd = process.platform === 'win32' ? `where ${PI_COMMAND}` : `which ${PI_COMMAND}`;
      this.deps.execSync(checkCmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  getVersion(): VersionInfo | null {
    try {
      const output = this.deps
        .execSync(`${PI_COMMAND} --version`, {
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
    const systemPrompt = options.systemPrompt ?? '';
    const prompt = options.prompt;

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
    const entry = { context, lastOutputAt: Date.now() };
    this.processes.set(pid, entry);

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
          this.processes.delete(pid);
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
    };
  }

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

  isAlive(pid: number): boolean {
    try {
      this.deps.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getTrackedProcesses(): ProcessInfo[] {
    return Array.from(this.processes.entries()).map(([pid, entry]) => ({
      pid,
      context: entry.context,
      lastOutputAt: entry.lastOutputAt,
    }));
  }

  untrack(pid: number): void {
    this.processes.delete(pid);
  }
}
