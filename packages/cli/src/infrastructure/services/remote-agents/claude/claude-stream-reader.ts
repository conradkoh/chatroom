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
    rl.on('line', (line) => this._handleLine(line));
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

  private _handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        message?: {
          content: {
            type: string;
            text?: string;
            thinking?: string;
            name?: string;
            input?: unknown;
          }[];
        };
      };
      this._dispatchEvent(event);
    } catch {
      // Non-JSON line — skip
    }
  }

  private _dispatchEvent(event: {
    type?: string;
    subtype?: string;
    message?: {
      content: { type: string; text?: string; thinking?: string; name?: string; input?: unknown }[];
    };
  }): void {
    const { type } = event;
    if (type === 'system') return;
    if (type === 'assistant') {
      this._handleAssistant(event);
      return;
    }
    if (type === 'result') {
      this._handleResult();
    }
  }

  private _handleAssistant(event: {
    message?: {
      content: { type: string; text?: string; thinking?: string; name?: string; input?: unknown }[];
    };
  }): void {
    const content = event.message?.content;
    if (!content) return;
    for (const block of content) {
      this._handleAssistantBlock(block);
    }
  }

  private _handleAssistantBlock(block: {
    type: string;
    text?: string;
    thinking?: string;
    name?: string;
    input?: unknown;
  }): void {
    if (block.type === 'text') {
      this._fireTextIfPresent(block.text);
      return;
    }
    if (block.type === 'thinking') {
      this._fireThinkingIfPresent(block.thinking);
      return;
    }
    if (block.type === 'tool_use') {
      this._fireToolUseIfPresent(block.name, block.input);
    }
  }

  private _fireTextIfPresent(text: string | undefined): void {
    if (!text) return;
    for (const cb of this.textCallbacks) cb(text);
  }

  private _fireThinkingIfPresent(thinking: string | undefined): void {
    if (!thinking) return;
    for (const cb of this.thinkingCallbacks) cb(thinking);
  }

  private _fireToolUseIfPresent(name: string | undefined, input: unknown): void {
    if (!name || !input) return;
    for (const cb of this.toolUseCallbacks) cb(name, input);
  }

  private _handleResult(): void {
    for (const cb of this.endCallbacks) cb();
  }
}
