/**
 * PiRpcReader — parses the newline-delimited JSON event stream emitted by
 * `pi --mode rpc` on stdout and surfaces typed callbacks for each event type.
 *
 * Pi RPC protocol (stdout, one JSON object per line):
 *
 *   text delta      – { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "..." } }
 *   thinking delta  – { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } }
 *   agent_start     – { type: "agent_start" }  → wire.ndjson.agent_start (CLI-only)
 *   agent_end       – { type: "agent_end" }    → wire.ndjson.agent_end → lifecycle.turn.completed
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
type StateResponseCallback = (sessionId: string) => void;

// ─── Implementation ───────────────────────────────────────────────────────────

export class PiRpcReader {
  private readonly textDeltaCallbacks: TextDeltaCallback[] = [];
  private readonly thinkingDeltaCallbacks: ThinkingDeltaCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly toolCallCallbacks: ToolCallCallback[] = [];
  private readonly toolResultCallbacks: ToolResultCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];
  private readonly stateResponseCallbacks: StateResponseCallback[] = [];

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

  /** Fires when a successful get_state RPC response arrives (spawn session discovery). */
  onStateResponse(cb: StateResponseCallback): void {
    this.stateResponseCallbacks.push(cb);
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

    this._dispatchEvent(event);
  }

  private _dispatchEvent(event: Record<string, unknown>): void {
    const type = event['type'];

    if (type === 'response' && event['command'] === 'get_state') {
      this._handleStateResponse(event);
      return;
    }

    if (type === 'message_update') {
      this._handleMessageUpdate(event);
      return;
    }

    if (type === 'agent_end') {
      for (const cb of this.agentEndCallbacks) cb();
      return;
    }

    if (type === 'tool_execution_start') {
      this._handleToolCallStart(event);
      return;
    }

    if (type === 'tool_execution_end') {
      this._handleToolCallEnd(event);
    }
  }

  private _handleStateResponse(event: Record<string, unknown>): void {
    const data = event['data'] as Record<string, unknown> | undefined;
    const sessionId = data?.['sessionId'];
    if (event['success'] === true && typeof sessionId === 'string') {
      for (const cb of this.stateResponseCallbacks) cb(sessionId);
    }
  }

  private _handleMessageUpdate(event: Record<string, unknown>): void {
    const assistantMessageEvent = event['assistantMessageEvent'] as
      | Record<string, unknown>
      | undefined;
    if (!assistantMessageEvent) return;

    const eventType = assistantMessageEvent['type'];
    if (eventType === 'text_delta') {
      const delta = assistantMessageEvent['delta'];
      if (typeof delta === 'string') {
        for (const cb of this.textDeltaCallbacks) cb(delta);
      }
    } else if (eventType === 'thinking_delta') {
      const delta = assistantMessageEvent['delta'];
      if (typeof delta === 'string') {
        for (const cb of this.thinkingDeltaCallbacks) cb(delta);
      }
    }
  }

  private _handleToolCallStart(event: Record<string, unknown>): void {
    const toolName = event['toolName'];
    const toolArgs = event['toolArgs'];
    if (typeof toolName === 'string') {
      for (const cb of this.toolCallCallbacks) cb(toolName, toolArgs);
    }
  }

  private _handleToolCallEnd(event: Record<string, unknown>): void {
    const toolName = event['toolName'];
    const toolResult = event['toolResult'] ?? event['output'] ?? event;
    if (typeof toolName === 'string') {
      for (const cb of this.toolResultCallbacks) cb(toolName, toolResult);
    }
  }
}
