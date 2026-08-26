/**
 * CopilotAgentService — concrete RemoteAgentService for GitHub Copilot CLI.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Encapsulates all interactions with GitHub Copilot CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * The GitHub Copilot CLI is invoked using the `copilot` command directly.
 * This is a standalone binary, not a gh extension.
 *
 * Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import {
  inferCopilotModelProvider,
  stripProviderPrefix,
} from '@workspace/backend/src/domain/entities/harness/model-provider.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { CopilotStreamReader } from './copilot-stream-reader.js';
import { createSessionLogCallbacks } from '../session-log-callbacks.js';

export type CopilotAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const COPILOT_COMMAND = 'copilot';

function resolveCopilotSpawnModel(model: string): string {
  return stripProviderPrefix(inferCopilotModelProvider(model), model);
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class CopilotAgentService extends BaseCLIAgentService {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly command = COPILOT_COMMAND;

  constructor(deps?: Partial<CopilotAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    // Check if copilot binary is installed
    return this.checkInstalled(COPILOT_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    // Check version using copilot --version
    return this.checkVersion(COPILOT_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Model list moved to the server catalog (api.harnesses.copilot.listModels) —
    // GitHub controls this set server-side, so it is no longer hard-coded here.
    // The daemon overlays the catalog onto discovery at boot / manual refresh.
    return [];
  }

  /**
   * Spawn a GitHub Copilot CLI agent.
   *
   * Command structure:
   *   copilot -p [--model <model>] [--allow-all] [--stream on] <prompt>
   *
   * The Copilot CLI processes the prompt and exits (single-shot mode).
   * The daemon's restart lifecycle handles multi-turn by spawning a fresh process
   * for each turn.
   *
   * Output format (plain text):
   *   ● Action description
   *   $ command to execute
   *   └ output
   */
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // The non-empty `prompt` invariant is enforced upstream by `createSpawnPrompt`
    // at the use-case layer (`agent-process-manager`). See
    // `daemon/infrastructure/local/harness/services/spawn-prompt.ts`.
    const { prompt } = options;

    // Build command arguments for non-interactive prompt mode
    const args: string[] = ['-p'];

    // Enable streaming for real-time output
    args.push('--stream', 'on');

    // Add model if specified
    if (options.model) {
      args.push('--model', resolveCopilotSpawnModel(options.model));
    }

    // Allow all tools automatically (required for non-interactive mode)
    args.push('--allow-all');

    // Add the prompt as the final argument
    args.push(prompt);

    const childProcess: ChildProcess = this.deps.spawn(COPILOT_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: this.agentSpawnEnv(options.resolvedConvexUrl),
    });

    const pid = await this.assertChildProcessStarted(childProcess);
    const context = options.context;

    // Register in process registry
    const entry = this.registerProcess(pid, context);

    // Build a log prefix from spawn context for easier debugging.
    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
    const logPrefix = `[copilot:${roleTag}${chatroomSuffix}]`;
    const { onLogLine, emitFormatted } = createSessionLogCallbacks();

    // Output tracking callbacks
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new CopilotStreamReader(childProcess.stdout);

      // Handle text output
      reader.onText((text) => {
        emitFormatted(`${logPrefix} ${text}`);
      });

      // Handle any event (for activity tracking)
      reader.onAnyEvent(() => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      // Handle agent end
      reader.onAgentEnd(() => {
        emitFormatted(`${logPrefix} agent_end`);
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (chunk: Buffer) => {
        emitFormatted(chunk.toString('utf8'), 'stderr');
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
      onLogLine,
    };
  }
}
