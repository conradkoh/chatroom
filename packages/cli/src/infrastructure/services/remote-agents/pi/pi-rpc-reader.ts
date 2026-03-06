/**
 * PiRpcReader — parses the newline-delimited JSON event stream emitted by
 * `pi --mode rpc` on stdout and surfaces typed callbacks for each event type.
 *
 * Pi RPC protocol (stdout, one JSON object per line):
 *
 *   text delta      – { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "..." } }
 *   thinking delta  – { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } }
 *   agent_start     – { type: "agent_start" }
 *   agent_end       – { type: "agent_end" }
 *   tool call       – { type: "tool_execution_start", toolName: "...", toolArgs: { ... } }
 *   tool result     – { type: "tool_execution_end", toolName: "...", ... }
 *   (unknown)       – any other object — ignored, but onAnyEvent still fires
 *
 * Note: For thinking models (e.g. opencode/big-pickle), turns that involve tool calls
 * produce thinking_delta events but no text_delta. Text output only appears in the
 * final turn when the agent writes its response. Capturing thinking_delta gives
 * visibility into what the agent is doing during intermediate tool-use turns.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Event types ─────────────────────────────────────────────────────────────

type TextDeltaCallback = (delta: string) => void;
type ThinkingDeltaCallback = (delta: string) => void;
type AgentEndCallback = () => void;
type ToolCallCallback = (name: string, args: unknown) => void;
type ToolResultCallback = (name: string, result: unknown) => void;
type AnyEventCallback = () => void;

// ─── Implementation ───────────────────────────────────────────────────────────

export class PiRpcReader {
  private readonly textDeltaCallbacks: TextDeltaCallback[] = [];
  private readonly thinkingDeltaCallbacks: ThinkingDeltaCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly toolCallCallbacks: ToolCallCallback[] = [];
  private readonly toolResultCallbacks: ToolResultCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this._handleLine(line));
  }

  /** Fires for every text token the model produces. */
  onTextDelta(cb: TextDeltaCallback): void {
    this.textDeltaCallbacks.push(cb);
  }

  /** Fires for every thinking token (extended thinking / reasoning models). */
  onThinkingDelta(cb: ThinkingDeltaCallback): void {
    this.thinkingDeltaCallbacks.push(cb);
  }

  /** Fires when the agent completes a turn (process stays alive). */
  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  /** Fires when a tool call starts (tool_execution_start). */
  onToolCall(cb: ToolCallCallback): void {
    this.toolCallCallbacks.push(cb);
  }

  /** Fires when a tool call completes (tool_execution_end). */
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
      // Non-JSON line (e.g. startup banner) — ignore silently
      return;
    }

    // Fire any-event callbacks first
    for (const cb of this.anyEventCallbacks) cb();

    const type = event['type'];

    if (type === 'message_update') {
      const assistantMessageEvent = event['assistantMessageEvent'] as
        | Record<string, unknown>
        | undefined;
      if (assistantMessageEvent?.['type'] === 'text_delta') {
        const delta = assistantMessageEvent['delta'];
        if (typeof delta === 'string') {
          for (const cb of this.textDeltaCallbacks) cb(delta);
        }
      } else if (assistantMessageEvent?.['type'] === 'thinking_delta') {
        const delta = assistantMessageEvent['delta'];
        if (typeof delta === 'string') {
          for (const cb of this.thinkingDeltaCallbacks) cb(delta);
        }
      }
      return;
    }

    if (type === 'agent_end') {
      for (const cb of this.agentEndCallbacks) cb();
      return;
    }

    if (type === 'tool_execution_start') {
      const toolName = event['toolName'];
      const toolArgs = event['toolArgs'];
      if (typeof toolName === 'string') {
        for (const cb of this.toolCallCallbacks) cb(toolName, toolArgs);
      }
      return;
    }

    if (type === 'tool_execution_end') {
      const toolName = event['toolName'];
      // The result field may be 'toolResult', 'output', or similar — fall back to whole event
      const toolResult = event['toolResult'] ?? event['output'] ?? event;
      if (typeof toolName === 'string') {
        for (const cb of this.toolResultCallbacks) cb(toolName, toolResult);
      }
      return;
    }

    // All other event types (agent_start, tool_execution_end, etc.) are silently
    // accepted — anyEventCallbacks already fired above.
  }
}
