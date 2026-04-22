/**
 * OpenCodeAgentService — concrete RemoteAgentService for the OpenCode runtime.
 *
 * Thin delegator over OpenCodeProcessDriver for arg building and prompt
 * construction. The actual spawn() wiring (process registry, onExit/onOutput)
 * remains here to preserve the RemoteAgentService contract without exposing
 * ChildProcess through the AgentToolDriver interface.
 *
 * All other shared boilerplate (stop/isAlive/getTrackedProcesses/untrack,
 * isInstalled/getVersion) is handled by BaseCLIAgentService.
 */

import { type ChildProcess } from 'node:child_process';
import { spawn, execSync } from 'node:child_process';

import { OpenCodeProcessDriver } from '../../../agent-drivers/opencode-process-driver.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';

export type OpenCodeAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';

// ─── Implementation ──────────────────────────────────────────────────────────

export class OpenCodeAgentService extends BaseCLIAgentService {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly command = OPENCODE_COMMAND;

  private readonly driver: OpenCodeProcessDriver;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
    // Wire driver with the same injected spawn/kill so tests can mock spawn
    this.driver = new OpenCodeProcessDriver({
      execSync: deps?.execSync ?? execSync,
      spawn: deps?.spawn ?? spawn,
      kill: deps?.kill ?? ((pid, signal) => process.kill(pid, signal)),
    });
  }

  isInstalled(): boolean {
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    return this.driver.listModels();
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // Delegate arg-building and prompt-building to the driver
    const args = this.driver.buildArgsForService(options.model);
    const fullPrompt = this.driver.buildPromptForService(options.systemPrompt, options.prompt);

    const childProcess: ChildProcess = this.deps.spawn(OPENCODE_COMMAND, args, {
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

    // Write combined prompt to stdin
    childProcess.stdin?.write(fullPrompt);
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
