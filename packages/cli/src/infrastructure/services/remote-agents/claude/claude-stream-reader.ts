/**
 * ClaudeStreamReader — parses the newline-delimited JSON event stream emitted by
 * `claude -p --output-format stream-json` on stdout and surfaces typed callbacks
 * for each event type.
 *
 * Claude Code stream-json protocol (stdout, one JSON object per line):
 *
 *   system init  – { type: "system", subtype: "init", session_id: "...", model: "...", ... }
 *   assistant    – { type: "assistant", message: { content: [...] }, session_id: "..." }
 *                  content blocks:
 *                    { type: "text", text: "..." }
 *                    { type: "thinking", thinking: "..." }
 *                    { type: "tool_use", id: "...", name: "...", input: { ... } }
 *   user         – { type: "user", message: { content: [...] }, session_id: "..." }
 *                  content blocks:
 *                    { type: "tool_result", tool_use_id: "...", content: [...] }
 *   result       – { type: "result", subtype: "success"|"error", result: "...", is_error: false, ... }
 *
 * Full event reference: https://docs.anthropic.com/en/docs/claude-code/sdk#output-formats
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Event types ─────────────────────────────────────────────────────────────

type TextCallback = (text: string) => void;
type ThinkingCallback = (thinking: string) => void;
type AgentEndCallback = () => void;
type ToolCallCallback = (name: string, input: unknown) => void;

// ─── Stream parser ─────────────────────────────────────────────────────────

/**
 * Parses NDJSON from a Claude Code stream and dispatches to typed callbacks.
 */
export class ClaudeStreamReader {
  private textCallbacks: TextCallback[] = [];
  private thinkingCallbacks: ThinkingCallback[] = [];
  private endCallbacks: AgentEndCallback[] = [];
  private toolUseCallbacks: ToolCallCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const event = JSON.parse(line);
        this.dispatch(event);
      } catch (err) {
        // Non-JSON line — skip it (might be plain text in non-stream-json mode)
      }
    });
  }

  onText(cb: TextCallback): void {
    this.textCallbacks.push(cb);
  }

  onThinking(cb: ThinkingCallback): void {
    this.thinkingCallbacks.push(cb);
  }

  onEnd(cb: AgentEndCallback): void {
    this.endCallbacks.push(cb);
  }

  onToolUse(cb: ToolCallCallback): void {
    this.toolUseCallbacks.push(cb);
  }

  private dispatch(event: {
    type?: string;
    subtype?: string;
    message?: {
      content: {
        type: string;
        text?: string;
        thinking?: string;
        name?: string;
        input?: unknown;
        tool_use_id?: string;
      }[];
    };
    result?: string;
    is_error?: boolean;
  }): void {
    const { type, subtype, message } = event;

    // System event: init, done, etc.
    if (type === 'system') {
      if (subtype === 'init') {
        // Agent initialized — no-op, useful for debugging
      }
      return;
    }

    // Assistant message with content blocks
    if (type === 'assistant' && message?.content) {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          for (const cb of this.textCallbacks) cb(block.text);
        } else if (block.type === 'thinking' && block.thinking) {
          for (const cb of this.thinkingCallbacks) cb(block.thinking);
        } else if (block.type === 'tool_use' && block.name && block.input) {
          for (const cb of this.toolUseCallbacks) cb(block.name, block.input);
        }
      }
      return;
    }

    // Result: success or error — agent has finished
    if (type === 'result') {
      for (const cb of this.endCallbacks) cb();
      return;
    }
  }
}
