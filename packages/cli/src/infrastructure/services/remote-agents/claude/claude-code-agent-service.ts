/**
 * ClaudeCodeAgentService — concrete RemoteAgentService for the Claude Code CLI runtime.
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

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';
import { ClaudeStreamReader } from './claude-stream-reader.js';

export type ClaudeCodeAgentServiceDeps = CLIAgentServiceDeps;

/**
 * Default trigger message used when the caller provides no prompt.
 *
 * Claude Code requires a non-empty prompt argument in print mode (-p).
 * When the init prompt is empty (e.g. composeInitMessage returns ''), we send
 * this trigger so the agent reads its system prompt and begins working.
 */
const DEFAULT_TRIGGER_PROMPT =
  'Please read your system prompt carefully and follow the Getting Started instructions.';

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

  isInstalled(): boolean {
    return this.checkInstalled(CLAUDE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(CLAUDE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Claude Code doesn't have a built-in model listing command.
    // Return the known supported models.
    // Full list: https://docs.anthropic.com/en/docs/about-claude/models/overview
    return ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { systemPrompt, model } = options;

    // Claude Code requires a non-empty prompt in print mode — fall back to a
    // default trigger when the caller passes an empty prompt (e.g. composeInitMessage returns '').
    const prompt = options.prompt?.trim() ? options.prompt : DEFAULT_TRIGGER_PROMPT;

    // Build args for print mode (-p): non-interactive, processes prompt and exits.
    // stream-json emits one NDJSON event per line so we can parse and log in real-time.
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

    // Set max turns for agentic operation
    args.push('--max-turns', String(DEFAULT_MAX_TURNS));

    if (model) {
      args.push('--model', model);
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // The prompt is passed as a positional argument
    args.push(prompt);

    const childProcess: ChildProcess = this.deps.spawn(CLAUDE_COMMAND, args, {
      cwd: options.workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: {
        ...process.env,
        // Prevent git rebase/merge from opening an interactive editor
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      },
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
    const entry = this.registerProcess(pid, context);

    // Build a log prefix from spawn context for easier debugging.
    // Format: [claude:role] or [claude:role@short-id] when chatroomId is available.
    const roleTag = context.role ?? 'unknown';
    const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
    const logPrefix = `[claude:${roleTag}${chatroomSuffix}]`;

    // Output tracking callbacks (for external consumers) + internal timestamp update
    const outputCallbacks: (() => void)[] = [];

    if (childProcess.stdout) {
      const reader = new ClaudeStreamReader(childProcess.stdout);

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

      // Handle text content blocks
      reader.onText((text) => {
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
        entry.lastOutputAt = Date.now();
        thinkingBuffer += thinking;
        if (thinking.includes('\n\n') || thinking.endsWith('\n')) {
          flushThinking();
        }
        for (const cb of outputCallbacks) cb();
      });

      // Handle tool use invocations — log and track in entry
      reader.onToolUse((name, input) => {
        entry.lastOutputAt = Date.now();
        const inputStr = JSON.stringify(input);
        process.stdout.write(
          `${logPrefix} tool] ${name}(${inputStr.slice(0, 100)}${inputStr.length > 100 ? '...' : ''})\n`
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
