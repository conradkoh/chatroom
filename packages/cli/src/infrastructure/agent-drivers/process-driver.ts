/**
 * Process-Based Agent Driver — Base Class
 *
 * Wraps the common child_process.spawn pattern used by
 * the process-based OpenCode driver. Subclasses override buildSpawnArgs()
 * and optionally writePromptToStdin() to customize per-harness behavior.
 *
 * SECURITY: All spawn calls use shell: false. Prompts are passed via
 * stdin or temp files — never as shell-interpreted arguments.
 */

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentCapabilities,
  AgentHandle,
  AgentStartOptions,
  AgentHarnessDriver,
  DriverStartResult,
  ProcessExitCallback,
} from './types.js';
import type { AgentHarness } from '../machine/types.js';

// ─── Shared Utilities ────────────────────────────────────────────────────────

/**
 * Write prompt to a temp file and return the path.
 * Used for harnesses that need prompts passed via file to avoid
 * arg length limits and shell injection.
 */
export function writeTempPromptFile(prompt: string): string {
  const tempPath = join(tmpdir(), `chatroom-prompt-${randomUUID()}.txt`);
  writeFileSync(tempPath, prompt, { encoding: 'utf-8', mode: 0o600 });
  return tempPath;
}

/**
 * Schedule cleanup of a temp file after a delay.
 */
export function scheduleCleanup(filePath: string, delayMs = 5000): void {
  setTimeout(() => {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore cleanup errors — file may already be deleted
    }
  }, delayMs);
}

/**
 * Build combined prompt from role prompt and initial message.
 */
export function buildCombinedPrompt(rolePrompt: string, initialMessage: string): string {
  return `${rolePrompt}\n\n${initialMessage}`;
}

// ─── Spawn Configuration ─────────────────────────────────────────────────────

/**
 * Configuration returned by subclass buildSpawnArgs().
 * Tells the base class how to spawn the child process.
 */
export interface SpawnConfig {
  /** The executable command (e.g. 'opencode') */
  command: string;
  /** Command-line arguments */
  args: string[];
  /** stdio configuration for the child process */
  stdio: StdioOptions;
  /** If true, the base class writes the combined prompt to stdin after spawn */
  writePromptToStdin: boolean;
  /** The prompt string to write to stdin (only used if writePromptToStdin is true) */
  stdinPrompt?: string;
  /** Optional cleanup callback invoked after spawn (e.g. to schedule temp file deletion) */
  afterSpawn?: (child: ChildProcess) => void;
}

// ─── Base Class ──────────────────────────────────────────────────────────────

/**
 * Base driver for process-based agent harnesses (e.g. OpenCode).
 *
 * Subclasses must implement:
 *   - harness: the AgentHarness identifier
 *   - capabilities: static capability declaration
 *   - buildSpawnConfig(): returns SpawnConfig for the child process
 *
 * The base class handles:
 *   - Spawning + detaching the child process
 *   - Writing prompt to stdin (if configured)
 *   - PID-based liveness checking
 *   - SIGTERM-based stopping
 */
export abstract class ProcessDriver implements AgentHarnessDriver {
  abstract readonly harness: AgentHarness;
  abstract readonly capabilities: AgentCapabilities;

  /**
   * Build the spawn configuration for this harness.
   * Subclasses customize command, args, stdio, and prompt delivery.
   */
  protected abstract buildSpawnConfig(options: AgentStartOptions): SpawnConfig;

  /**
   * Start an agent process.
   */
  async start(options: AgentStartOptions): Promise<DriverStartResult> {
    const config = this.buildSpawnConfig(options);

    console.log(`   Spawning ${this.harness} agent...`);
    console.log(`   Working dir: ${options.workingDir}`);
    if (options.harnessVersion) {
      console.log(
        `   Harness version: v${options.harnessVersion.version} (major: ${options.harnessVersion.major})`
      );
    }
    if (options.model) {
      console.log(`   Model: ${options.model}`);
    }

    try {
      const childProcess = spawn(config.command, config.args, {
        cwd: options.workingDir,
        stdio: config.stdio,
        detached: true,
        shell: false,
      });

      // Write prompt to stdin if configured
      if (config.writePromptToStdin && config.stdinPrompt) {
        childProcess.stdin?.write(config.stdinPrompt);
        childProcess.stdin?.end();
      }

      // Run post-spawn hook (e.g. temp file cleanup)
      config.afterSpawn?.(childProcess);

      // Unref so parent can exit independently
      childProcess.unref();

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check if process immediately crashed
      if (childProcess.killed || childProcess.exitCode !== null) {
        return {
          success: false,
          message: `Agent process exited immediately (exit code: ${childProcess.exitCode})`,
        };
      }

      const handle: AgentHandle = {
        harness: this.harness,
        type: 'process',
        pid: childProcess.pid,
        workingDir: options.workingDir,
      };

      return {
        success: true,
        message: 'Agent spawned successfully',
        handle,
        // Expose the child process exit event so the daemon can detect unexpected death
        onExit: (callback: ProcessExitCallback) => {
          childProcess.on('exit', (code, signal) => {
            callback(code, signal);
          });
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to spawn agent: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Stop an agent by sending SIGTERM, then SIGKILL if it doesn't exit.
   *
   * 1. Sends SIGTERM for graceful shutdown
   * 2. Polls every 200ms for up to 5 seconds
   * 3. If still alive, sends SIGKILL as a last resort
   */
  async stop(handle: AgentHandle): Promise<void> {
    if (handle.type !== 'process' || !handle.pid) {
      throw new Error(`Cannot stop: handle has no PID (type=${handle.type})`);
    }

    const pid = handle.pid;

    // Send SIGTERM first
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return; // Process already exited (ESRCH)
    }

    // Wait up to 5 seconds for graceful exit
    const KILL_TIMEOUT_MS = 5000;
    const POLL_INTERVAL_MS = 200;
    const deadline = Date.now() + KILL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0); // Check if still alive
      } catch {
        return; // Process exited
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Still alive — force kill
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process may have exited between check and kill
    }
  }

  /**
   * Check if an agent's process is still alive via kill -0.
   */
  async isAlive(handle: AgentHandle): Promise<boolean> {
    if (handle.type !== 'process' || !handle.pid) {
      return false;
    }
    try {
      process.kill(handle.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Process-based drivers cannot recover handles after daemon restart
   * because detached child PIDs are not persisted.
   * Returns an empty array.
   */
  async recover(_workingDir: string): Promise<AgentHandle[]> {
    return [];
  }

  /**
   * Process-based drivers don't support dynamic model discovery.
   * Subclasses can override to return static model lists.
   */
  async listModels(): Promise<string[]> {
    return [];
  }
}
