/**
 * PiAgentService — concrete RemoteAgentService for the Pi CLI runtime.
 *
 * Encapsulates all interactions with the `pi` CLI: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   pi --mode rpc --no-session [--model <model>] [--system-prompt <systemPrompt>]
 *
 * The prompt is sent to the long-running process over stdin as a JSON command:
 *   {"type": "prompt", "message": "<prompt>"}
 *
 * Pi streams events back on stdout as newline-delimited JSON, parsed by PiRpcReader.
 * Text and thinking deltas are buffered per-line and emitted with [pi text] /
 * [pi thinking] prefixes so PM2 / daemon logs capture them as distinct log lines.
 * The process stays alive after each turn so future prompts can be sent over stdin.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { PiRpcReader } from './pi-rpc-reader.js';

export type PiAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const PI_COMMAND = 'pi';

/**
 * Default trigger message used when the caller provides no prompt.
 *
 * Pi requires at least one user message to call the AI API. When the init
 * prompt is empty (e.g. composeInitMessage returns ''), we send this trigger
 * so Pi can read the system prompt and execute the Getting Started steps.
 */
const DEFAULT_TRIGGER_PROMPT =
  'Please read your system prompt carefully and follow the Getting Started instructions.';

// ─── Implementation ──────────────────────────────────────────────────────────

export class PiAgentService extends BaseCLIAgentService {
  readonly id = 'pi';
  readonly displayName = 'Pi';
  readonly command = PI_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  isInstalled(): boolean {
    return this.checkInstalled(PI_COMMAND);
  }

  getVersion() {
    return this.checkVersion(PI_COMMAND);
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
    const { systemPrompt, model } = options;

    // Pi requires at least one user message — fall back to a default trigger when
    // the caller passes an empty prompt (e.g. composeInitMessage returns '').
    const prompt = options.prompt?.trim() ? options.prompt : DEFAULT_TRIGGER_PROMPT;

    // Build args for RPC mode. The prompt is NOT a positional arg — it is sent
    // over stdin as a JSON command after the process starts.
    const args: string[] = ['--mode', 'rpc', '--no-session'];

    if (model) {
      args.push('--model', model);
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const childProcess: ChildProcess = this.deps.spawn(PI_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });

    // Send the initial prompt as a JSON RPC command over stdin.
    // Do NOT close stdin — the process must stay alive to receive future prompts.
    childProcess.stdin?.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n');

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
    // Format: [pi:role] or [pi:role@short-id] when chatroomId is available.
    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId
      ? `@${context.chatroomId.slice(-6)}`
      : '';
    const logPrefix = `[pi:${roleTag}${chatroomSuffix}`;

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      // Parse the RPC JSON event stream — fire output callbacks on every event
      // so the daemon knows the agent is still producing output.
      const reader = new PiRpcReader(childProcess.stdout);

      // Buffer accumulated text/thinking so we can emit complete lines with
      // a [pi:role text] / [pi:role thinking] prefix — PM2 captures output
      // per-line, so raw streaming tokens without newlines don't appear as
      // distinct log entries. We flush on natural newlines in the delta and
      // on section boundaries.
      let textBuffer = '';
      let thinkingBuffer = '';

      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) process.stdout.write(`${logPrefix} text] ${line}\n`);
        }
        textBuffer = '';
      };

      const flushThinking = () => {
        if (!thinkingBuffer) return;
        for (const line of thinkingBuffer.split('\n')) {
          if (line) process.stdout.write(`${logPrefix} thinking] ${line}\n`);
        }
        thinkingBuffer = '';
      };

      reader.onTextDelta((delta) => {
        flushThinking(); // switch section
        textBuffer += delta;
        // Flush on natural line breaks so logs stay responsive
        if (textBuffer.includes('\n')) flushText();
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onThinkingDelta((delta) => {
        flushText(); // switch section
        thinkingBuffer += delta;
        // Flush on natural line breaks
        if (thinkingBuffer.includes('\n')) flushThinking();
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAnyEvent(() => {
        // Non-text events (agent_start, tool_execution_start/end, agent_end, …)
        // still count as activity for the purposes of the output timestamp.
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAgentEnd(() => {
        // Flush any buffered text before the turn boundary marker
        flushText();
        flushThinking();
        process.stdout.write(`${logPrefix} agent_end]\n`);
      });

      reader.onToolCall((name, args) => {
        // Flush buffered content before the tool marker
        flushText();
        flushThinking();
        const argsStr = args != null ? ` args: ${JSON.stringify(args)}` : '';
        process.stdout.write(`${logPrefix} tool: ${name}${argsStr}]\n`);
      });

      reader.onToolResult((name, result) => {
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        process.stdout.write(`${logPrefix} tool_result: ${name} result: ${resultStr}]\n`);
      });

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
        onAgentEnd: (cb) => {
          reader.onAgentEnd(cb);
        },
      };
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
