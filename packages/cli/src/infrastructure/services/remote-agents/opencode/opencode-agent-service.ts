/**
 * OpenCodeAgentService — concrete RemoteAgentService for the OpenCode runtime.
 *
 * Encapsulates all interactions with OpenCode: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';

import type {
  RemoteAgentService,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
} from '../remote-agent-service.js';

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface OpenCodeAgentServiceDeps {
  /** Execute a synchronous command (for detection/version/model queries). */
  execSync: (cmd: string, options?: object) => Buffer;
  /** Spawn a child process (for agent lifecycle). */
  spawn: typeof spawn;
  /** Check if a PID is alive. Throws if dead. */
  kill: (pid: number, signal: number | string) => boolean;
}

function defaultDeps(): OpenCodeAgentServiceDeps {
  return {
    execSync,
    spawn,
    kill: (pid, signal) => process.kill(pid, signal),
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';
const KILL_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

// ─── Implementation ──────────────────────────────────────────────────────────

export class OpenCodeAgentService implements RemoteAgentService {
  private readonly deps: OpenCodeAgentServiceDeps;

  constructor(deps?: Partial<OpenCodeAgentServiceDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  isInstalled(): boolean {
    try {
      const checkCmd =
        process.platform === 'win32' ? `where ${OPENCODE_COMMAND}` : `which ${OPENCODE_COMMAND}`;
      this.deps.execSync(checkCmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  getVersion(): VersionInfo | null {
    try {
      const output = this.deps
        .execSync(`${OPENCODE_COMMAND} --version`, {
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
        .execSync(`${OPENCODE_COMMAND} models`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })
        .toString()
        .trim();

      if (!output) return [];

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const args: string[] = ['run'];
    if (options.model) {
      args.push('--model', options.model);
    }

    const childProcess: ChildProcess = this.deps.spawn(OPENCODE_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });

    // Write prompt to stdin
    childProcess.stdin?.write(options.prompt);
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

    // Output tracking callbacks
    const outputCallbacks: (() => void)[] = [];
    if (childProcess.stdout) {
      childProcess.stdout.pipe(process.stdout, { end: false });
      childProcess.stdout.on('data', () => {
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.pipe(process.stderr, { end: false });
      childProcess.stderr.on('data', () => {
        for (const cb of outputCallbacks) cb();
      });
    }

    return {
      pid,
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          cb(code, signal);
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
}
