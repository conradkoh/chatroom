/**
 * ClaudeCodeAgentService — concrete RemoteAgentService for the Claude Code CLI runtime.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Encapsulates all interactions with Claude Code: installation detection,
 * version queries, model discovery, agent spawning, and process lifecycle.
 *
 * Spawns agents using:
 *   claude -p --output-format stream-json --verbose --model <model> --system-prompt <systemPrompt> --max-turns 200 <prompt>
 *
 * Claude Code runs in "print mode" (-p) which processes the prompt and exits.
 * The prompt is passed as a positional argument and the system prompt via --system-prompt.
 *
 * Extends BaseCLIAgentService which handles all shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * the underlying isInstalled/getVersion helpers.
 */

import { type ChildProcess } from 'node:child_process';

import { decodeClaudeVariant } from './claude-models.js';
import { ClaudeStreamReader } from './claude-stream-reader.js';
import { createHarnessActivityEmitter } from '../../../../agent-process-manager/harness-activity-emitter.js';
import {
  BASH_TOOL_KIND,
  buildAgentLogPrefix,
  extractBashCommandFromToolInput,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { createSessionLogCallbacks } from '../session-log-callbacks.js';

export type ClaudeCodeAgentServiceDeps = CLIAgentServiceDeps;

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_COMMAND = 'claude';

/**
 * Default max turns for Claude Code agentic mode.
 * Each "turn" is one model response → tool use → model response cycle.
 * 200 turns gives the agent plenty of room for complex tasks.
 */
const DEFAULT_MAX_TURNS = 200;

// ─── Implementation ──────────────────────────────────────────────────────────

export class ClaudeCodeAgentService extends BaseCLIAgentService {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly command = CLAUDE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(CLAUDE_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(CLAUDE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  // fallow-ignore-next-line complexity
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    // The non-empty `prompt` invariant is enforced upstream by `createSpawnPrompt`
    // at the use-case layer (`agent-process-manager`). See
    // `daemon/infrastructure/local/harness/services/spawn-prompt.ts`.
    const { prompt, systemPrompt, model } = options;

    // Build args for print mode (-p): non-interactive, processes prompt and exits.
    // stream-json emits one NDJSON event per line so we can parse and log in real-time.
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

    // Set max turns for agentic operation
    args.push('--max-turns', String(DEFAULT_MAX_TURNS));

    if (model) {
      const variant = decodeClaudeVariant(model);
      if (variant) {
        args.push('--model', variant.model);
        if (variant.effort) args.push('--effort', variant.effort);
      }
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // The prompt is passed as a positional argument
    args.push(prompt);

    const activityEmitter = createHarnessActivityEmitter();
    activityEmitter.beginTurn();

    const childProcess: ChildProcess = this.deps.spawn(CLAUDE_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: this.agentSpawnEnv(options.resolvedConvexUrl),
    });

    const pid = await this.assertChildProcessStarted(childProcess);
    const context = options.context;

    // Register in process registry
    const entry = this.registerProcess(pid, context);

    // Build a log prefix from spawn context for easier debugging.
    // Format: [claude:role] or [claude:role@short-id] when chatroomId is available.
    const logPrefix = buildAgentLogPrefix('claude', context);
    const { onLogLine, emitFormatted } = createSessionLogCallbacks();

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new ClaudeStreamReader(childProcess.stdout);

      let textBuffer = '';
      let thinkingBuffer = '';

      const emitActivity = (
        kind: 'transport' | 'progress' | 'waiting' | 'failure',
        source: string
      ) => {
        activityEmitter.emit({ kind, source, at: Date.now() });
      };

      const flushText = () => {
        if (!textBuffer) return;
        for (const line of textBuffer.split('\n')) {
          if (line) emitFormatted(formatAgentLogLine(logPrefix, 'text', line));
        }
        textBuffer = '';
      };

      const flushThinking = () => {
        if (!thinkingBuffer) return;
        for (const line of thinkingBuffer.split('\n')) {
          if (line) emitFormatted(formatAgentLogLine(logPrefix, 'thinking', line));
        }
        thinkingBuffer = '';
      };

      // Handle text content blocks
      reader.onText((text) => {
        emitActivity('progress', 'claude-cli.assistant.text');
        entry.lastOutputAt = Date.now();
        textBuffer += text;
        // Buffer and flush on complete chunks
        if (text.includes('\n\n') || text.endsWith('\n')) {
          flushText();
        }
        for (const cb of outputCallbacks) cb();
      });

      // Handle thinking (reasoning) content blocks
      reader.onThinking((thinking) => {
        emitActivity('progress', 'claude-cli.assistant.thinking');
        entry.lastOutputAt = Date.now();
        thinkingBuffer += thinking;
        if (thinking.includes('\n\n') || thinking.endsWith('\n')) {
          flushThinking();
        }
        for (const cb of outputCallbacks) cb();
      });

      // Handle tool use invocations — log and track in entry
      // fallow-ignore-next-line complexity
      reader.onToolUse((name, input) => {
        emitActivity('progress', 'claude-cli.tool-use');
        emitActivity('waiting', 'claude-cli.tool-use');
        entry.lastOutputAt = Date.now();
        const bashCmd = extractBashCommandFromToolInput(name, input);
        if (bashCmd !== null) {
          emitFormatted(
            formatAgentLogLine(logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd))
          );
          for (const cb of outputCallbacks) cb();
          return;
        }
        const inputStr = JSON.stringify(input);
        emitFormatted(
          formatAgentLogLine(
            logPrefix,
            'tool',
            `${name}(${inputStr.slice(0, 100)}${inputStr.length > 100 ? '...' : ''})`
          )
        );
        for (const cb of outputCallbacks) cb();
      });

      // Handle agent completion
      reader.onEnd(() => {
        entry.lastOutputAt = Date.now();
        flushText();
        flushThinking();
        for (const cb of outputCallbacks) cb();
      });

      reader.onAnyEvent((metadata) => {
        entry.lastOutputAt = Date.now();
        emitActivity('transport', 'claude-cli.message');
        if (metadata.isError) {
          emitActivity('failure', 'claude-cli.message');
        }
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (chunk: Buffer) => {
        activityEmitter.emit({ kind: 'transport', source: 'claude-cli.stderr', at: Date.now() });
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
