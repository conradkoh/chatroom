/**
 * OpenCodeAgentService — concrete RemoteAgentService for the OpenCode runtime.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Encapsulates all interactions with OpenCode: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { createHarnessActivityEmitter } from '../../../../agent-process-manager/harness-activity-emitter.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { parseOpencodeSpawnModel } from '../opencode-sdk/pure.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { createSessionLogCallbacks } from '../session-log-callbacks.js';

export type OpenCodeAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';

// ─── Implementation ──────────────────────────────────────────────────────────

export class OpenCodeAgentService extends BaseCLIAgentService {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly command = OPENCODE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    const output = await this.runListCommand('opencode', `${OPENCODE_COMMAND} models`);

    if (output === null) return [];

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  // fallow-ignore-next-line complexity
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const parsed = options.model ? parseOpencodeSpawnModel(options.model) : undefined;
    const args: string[] = ['run'];
    if (parsed?.model) {
      args.push('--model', parsed.model);
    }
    if (parsed?.variant) {
      args.push('--variant', parsed.variant);
    }

    // Combine systemPrompt and prompt — opencode doesn't have a --system-prompt flag,
    // so we prepend the role prompt to the initial message as a single combined prompt.
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.prompt}`
      : options.prompt;

    const activityEmitter = createHarnessActivityEmitter();
    activityEmitter.beginTurn();

    const childProcess: ChildProcess = this.deps.spawn(OPENCODE_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: this.agentSpawnEnv(options.resolvedConvexUrl),
    });

    // Write combined prompt to stdin
    childProcess.stdin?.write(fullPrompt);
    childProcess.stdin?.end();

    const pid = await this.assertChildProcessStarted(childProcess);
    const context = options.context;

    // Register in process registry
    const entry = this.registerProcess(pid, context);
    const { onLogLine, emitFormatted } = createSessionLogCallbacks();

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];
    let processFailureEmitted = false;

    const emitActivity = (
      kind: 'transport' | 'progress' | 'waiting' | 'failure',
      source: string
    ) => {
      activityEmitter.emit({ kind, source, at: Date.now() });
    };

    if (childProcess.stdout) {
      childProcess.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        emitActivity('transport', 'opencode-cli.stdout');
        if (text.trim().length > 0) {
          emitActivity('progress', 'opencode-cli.assistant.text');
        }
        emitFormatted(text, 'stdout');
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (chunk: Buffer) => {
        emitActivity('transport', 'opencode-cli.stderr');
        emitFormatted(chunk.toString('utf8'), 'stderr');
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }

    return {
      pid,
      activityEmitter,
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          this.deleteProcess(pid);
          if (!processFailureEmitted && ((code !== null && code !== 0) || signal !== null)) {
            processFailureEmitted = true;
            emitActivity('failure', 'opencode-cli.process');
          }
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onLogLine,
    };
  }
}
