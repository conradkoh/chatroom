/**
 * CursorStreamReader — parses the newline-delimited JSON event stream emitted by
 * `agent -p --output-format stream-json` on stdout and surfaces typed callbacks
 * for each event type.
 *
 * Cursor stream-json protocol (stdout, one JSON object per line):
 *
 *   system init      – { type: "system", subtype: "init", model: "...", session_id: "..." }
 *   user message     – { type: "user", message: { role: "user", content: [...] } }
 *   assistant text   – { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "..." }] } }
 *   tool call start  – { type: "tool_call", subtype: "started", call_id: "...", tool_call: { ... } }
 *   tool call done   – { type: "tool_call", subtype: "completed", call_id: "...", tool_call: { ... } }
 *   result           – { type: "result", subtype: "success", duration_ms: ..., session_id: "..." }
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Event types ─────────────────────────────────────────────────────────────

type TextCallback = (text: string) => void;
type AgentEndCallback = (sessionId: string | undefined) => void;
type ToolCallCallback = (callId: string, toolCall: unknown) => void;
type ToolResultCallback = (callId: string, toolCall: unknown) => void;
type AnyEventCallback = () => void;

// ─── Implementation ───────────────────────────────────────────────────────────

export class CursorStreamReader {
  private readonly textCallbacks: TextCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly toolCallCallbacks: ToolCallCallback[] = [];
  private readonly toolResultCallbacks: ToolResultCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this._handleLine(line));
  }

  /** Fires for each assistant message text segment. */
  onText(cb: TextCallback): void {
    this.textCallbacks.push(cb);
  }

  /** Fires when the agent completes (result event with subtype=success). */
  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  /** Fires when a tool call starts (tool_call subtype=started). */
  onToolCall(cb: ToolCallCallback): void {
    this.toolCallCallbacks.push(cb);
  }

  /** Fires when a tool call completes (tool_call subtype=completed). */
  onToolResult(cb: ToolResultCallback): void {
    this.toolResultCallbacks.push(cb);
  }

  /** Fires for every successfully parsed event, regardless of type. */
  onAnyEvent(cb: AnyEventCallback): void {
    this.anyEventCallbacks.push(cb);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    for (const cb of this.anyEventCallbacks) cb();

    const type = event['type'];
    const subtype = event['subtype'];

    if (type === 'assistant') {
      const message = event['message'] as Record<string, unknown> | undefined;
      const content = (message?.['content'] as Record<string, unknown>[]) ?? [];
      for (const block of content) {
        if (block['type'] === 'text' && typeof block['text'] === 'string') {
          for (const cb of this.textCallbacks) cb(block['text']);
        }
      }
      return;
    }

    if (type === 'tool_call') {
      const callId = (event['call_id'] as string) ?? '';
      const toolCall = event['tool_call'];
      if (subtype === 'started') {
        for (const cb of this.toolCallCallbacks) cb(callId, toolCall);
      } else if (subtype === 'completed') {
        for (const cb of this.toolResultCallbacks) cb(callId, toolCall);
      }
      return;
    }

    if (type === 'result' && subtype === 'success') {
      const sessionId = event['session_id'] as string | undefined;
      for (const cb of this.agentEndCallbacks) cb(sessionId);
      return;
    }
  }
}
