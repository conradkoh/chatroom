/**
 * OpenCodeAgentService — concrete RemoteAgentService for the OpenCode runtime.
 *
 * Encapsulates all interactions with OpenCode: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   opencode run --format json --print-logs [--model <model>]
 *
 * The prompt is sent over stdin. OpenCode streams JSON events on stdout,
 * parsed by OpenCodeJsonReader. Text events are buffered per-line and
 * emitted with [oc:role text] prefixes so PM2 / daemon logs capture them.
 * step_finish with reason "stop" triggers onAgentEnd.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { OpenCodeJsonReader } from './opencode-json-reader.js';

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

  isInstalled(): boolean {
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(OPENCODE_COMMAND);
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
    const args: string[] = ['run', '--format', 'json', '--print-logs'];
    if (options.model) {
      args.push('--model', options.model);
    }

    // Combine systemPrompt and prompt — opencode doesn't have a --system-prompt flag,
    // so we prepend the role prompt to the initial message as a single combined prompt.
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.prompt}`
      : options.prompt;

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

    // Build a log prefix from spawn context for easier debugging.
    // Format: [oc:role] or [oc:role@short-id] when chatroomId is available.
    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
    const logPrefix = `[oc:${roleTag}${chatroomSuffix}`;

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      // Parse the JSON event stream — fire output callbacks on every event
      // so the daemon knows the agent is still producing output.
      const reader = new OpenCodeJsonReader(childProcess.stdout);

      // Buffer accumulated text so we can emit complete lines with
      // an [oc:role text] prefix — PM2 captures output per-line, so
      // raw streaming tokens without newlines don't appear as distinct log entries.
      let textBuffer = '';

      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) process.stdout.write(`${logPrefix} text] ${line}\n`);
        }
        textBuffer = '';
      };

      reader.onText((text) => {
        textBuffer += text;
        // Always flush — OpenCode delivers full text per event (not streaming deltas)
        flushText();
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onToolUse((part) => {
        flushText();
        const toolName = typeof part['tool'] === 'string' ? part['tool'] : 'unknown';
        const state = part['state'] as Record<string, unknown> | undefined;
        const input = state?.['input'];
        const output = state?.['output'];
        // Log tool name and input summary
        if (input && typeof input === 'object') {
          const inputStr = JSON.stringify(input);
          const truncated = inputStr.length > 200 ? inputStr.slice(0, 200) + '...' : inputStr;
          process.stdout.write(`${logPrefix} tool: ${toolName} input: ${truncated}]\n`);
        } else {
          process.stdout.write(`${logPrefix} tool: ${toolName}]\n`);
        }
        // Log tool output if available (truncated for readability)
        if (output && typeof output === 'string') {
          const truncated = output.length > 500 ? output.slice(0, 500) + '...' : output;
          for (const line of truncated.split('\n')) {
            if (line) process.stdout.write(`${logPrefix} tool_output] ${line}\n`);
          }
        }
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAnyEvent(() => {
        // All events count as activity for output timestamp purposes.
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onStepStart(() => {
        process.stdout.write(`${logPrefix} step_start]\n`);
      });

      reader.onStepFinish((reason) => {
        process.stdout.write(`${logPrefix} step_finish: ${reason}]\n`);
      });

      reader.onAgentEnd(() => {
        // Flush any buffered text before the turn boundary marker
        flushText();
        process.stdout.write(`${logPrefix} agent_end]\n`);
      });

      if (childProcess.stderr) {
        // Parse stderr line-by-line so we can prefix each line with the agent tag
        // for consistent daemon log formatting (--print-logs sends debug output here).
        const stderrRl = createInterface({ input: childProcess.stderr, crlfDelay: Infinity });
        stderrRl.on('line', (line) => {
          if (line.trim()) {
            process.stdout.write(`${logPrefix} log] ${line}\n`);
          }
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
        onAgentEnd: (cb) => {
          reader.onAgentEnd(cb);
        },
      };
    }

    if (childProcess.stderr) {
      const stderrRl = createInterface({ input: childProcess.stderr, crlfDelay: Infinity });
      stderrRl.on('line', (line) => {
        if (line.trim()) {
          process.stdout.write(`${logPrefix} log] ${line}\n`);
        }
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
