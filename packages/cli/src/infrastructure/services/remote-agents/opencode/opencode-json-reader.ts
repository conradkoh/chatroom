/**
 * OpenCodeJsonReader — parses the newline-delimited JSON event stream emitted by
 * `opencode run --format json` on stdout and surfaces typed callbacks for each event type.
 *
 * OpenCode JSON protocol (stdout, one JSON object per line):
 *
 *   step_start   – { type: "step_start", part: { type: "step-start" } }
 *   text         – { type: "text", part: { type: "text", text: "Hello." } }
 *   tool_use     – { type: "tool_use", part: { type: "tool" } }
 *   step_finish  – { type: "step_finish", part: { type: "step-finish", reason: "stop" | "tool-calls" } }
 *
 * Key: step_finish with part.reason === "stop" means the agent turn is complete (= onAgentEnd).
 *
 * Note: Non-JSON lines (ANSI banner, log lines) may appear on stdout and are ignored gracefully.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Callback types ──────────────────────────────────────────────────────────

type TextCallback = (text: string) => void;
type ToolUseCallback = (part: Record<string, unknown>) => void;
type StepStartCallback = () => void;
type StepFinishCallback = (reason: string) => void;
type AgentEndCallback = () => void;
type AnyEventCallback = () => void;

// ─── Implementation ───────────────────────────────────────────────────────────

export class OpenCodeJsonReader {
  private readonly textCallbacks: TextCallback[] = [];
  private readonly toolUseCallbacks: ToolUseCallback[] = [];
  private readonly stepStartCallbacks: StepStartCallback[] = [];
  private readonly stepFinishCallbacks: StepFinishCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this._handleLine(line));
  }

  /** Fires when a text event is received with the full text content. */
  onText(cb: TextCallback): void {
    this.textCallbacks.push(cb);
  }

  /** Fires when a tool_use event is received. */
  onToolUse(cb: ToolUseCallback): void {
    this.toolUseCallbacks.push(cb);
  }

  /** Fires when a step_start event is received. */
  onStepStart(cb: StepStartCallback): void {
    this.stepStartCallbacks.push(cb);
  }

  /** Fires when a step_finish event is received, with the reason. */
  onStepFinish(cb: StepFinishCallback): void {
    this.stepFinishCallbacks.push(cb);
  }

  /** Fires when the agent completes a turn (step_finish with reason "stop"). */
  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
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
      // Non-JSON line (e.g. ANSI banner, log line) — ignore silently
      return;
    }

    // Fire any-event callbacks first
    for (const cb of this.anyEventCallbacks) cb();

    const type = event['type'];

    if (type === 'text') {
      const part = event['part'] as Record<string, unknown> | undefined;
      if (part && typeof part['text'] === 'string') {
        for (const cb of this.textCallbacks) cb(part['text'] as string);
      }
      return;
    }

    if (type === 'tool_use') {
      const part = (event['part'] as Record<string, unknown>) ?? {};
      for (const cb of this.toolUseCallbacks) cb(part);
      return;
    }

    if (type === 'step_start') {
      for (const cb of this.stepStartCallbacks) cb();
      return;
    }

    if (type === 'step_finish') {
      const part = event['part'] as Record<string, unknown> | undefined;
      const reason = typeof part?.['reason'] === 'string' ? (part['reason'] as string) : '';

      for (const cb of this.stepFinishCallbacks) cb(reason);

      if (reason === 'stop') {
        for (const cb of this.agentEndCallbacks) cb();
      }
      return;
    }

    // All other event types (step_start, etc.) are silently accepted —
    // anyEventCallbacks already fired above.
  }
}
