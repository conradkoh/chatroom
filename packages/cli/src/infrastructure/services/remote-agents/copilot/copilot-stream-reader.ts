/**
 * CopilotStreamReader — parses the plain text output emitted by `copilot -p` on stdout.
 *
 * Copilot CLI output format (plain text, line by line):
 *
 *   ● Description of action
 *   $ command to execute
 *   └ output lines
 *   ...
 *   Done.
 *
 * Completion is detected by the "Done." line.
 *
 * Since there's no structured JSON mode available for Copilot CLI,
 * this reader parses plain text and fires simplified callbacks:
 * - onText: for each line of output
 * - onAgentEnd: when "Done." is detected
 * - onToolCall: NOT available in plain text mode (skipped)
 * - onToolResult: NOT available in plain text mode (skipped)
 * - onAnyEvent: fires for activity tracking
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Event types ─────────────────────────────────────────────────────────────

type TextCallback = (text: string) => void;
type AgentEndCallback = () => void;
type AnyEventCallback = () => void;

/**
 * Callback types for tool events (not used in plain text mode).
 * Defined for interface compatibility but will never fire.
 */
type ToolCallCallback = (callId: string, toolCall: unknown) => void;
type ToolResultCallback = (callId: string, toolCall: unknown) => void;

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Marker line that indicates agent completion
 */
const DONE_MARKER = 'Done.';

/**
 * Lines that should be logged but not passed to onText callbacks
 */
const SKIP_PREFIXES = ['Total usage est:', 'API time spent:', 'Total session time:', 'Total code changes:', 'Breakdown by AI model:'];

export class CopilotStreamReader {
  private readonly textCallbacks: TextCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];
  private agentEnded = false;

  // Callbacks that are not used in plain text mode but defined for interface compatibility
   
  private readonly toolCallCallbacks: ToolCallCallback[] = [];
   
  private readonly toolResultCallbacks: ToolResultCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this._handleLine(line));
  }

  /** Fires for each text line of output. */
  onText(cb: TextCallback): void {
    this.textCallbacks.push(cb);
  }

  /** Fires when the agent completes (Done. line detected). */
  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  /**
   * Tool call callback — NOT available in plain text mode.
   * Kept for interface compatibility with other readers.
   */
   
  onToolCall(_cb: ToolCallCallback): void {
    // Not available in plain text mode
  }

  /**
   * Tool result callback — NOT available in plain text mode.
   * Kept for interface compatibility with other readers.
   */
   
  onToolResult(_cb: ToolResultCallback): void {
    // Not available in plain text mode
  }

  /** Fires for every line received, for activity tracking. */
  onAnyEvent(cb: AnyEventCallback): void {
    this.anyEventCallbacks.push(cb);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _handleLine(line: string): void {
    // Fire any-event callback for activity tracking
    for (const cb of this.anyEventCallbacks) cb();

    // Check for completion marker
    if (line.trim() === DONE_MARKER) {
      this.agentEnded = true;
      for (const cb of this.agentEndCallbacks) cb();
      return;
    }

    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) return;

    // Skip metadata lines (usage stats, etc.)
    for (const prefix of SKIP_PREFIXES) {
      if (trimmed.startsWith(prefix)) return;
    }

    // Pass text to callbacks
    for (const cb of this.textCallbacks) cb(trimmed);
  }
}
