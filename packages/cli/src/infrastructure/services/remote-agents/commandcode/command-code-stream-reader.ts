/**
 * CommandCodeStreamReader — reads plain-text stdout from `cmd -p` headless mode
 * and surfaces typed callbacks for text output and agent completion.
 *
 * Per https://commandcode.ai/docs/core-concepts/headless, `cmd -p` writes a
 * plain-text response to stdout (no stream-json protocol). Each non-empty line
 * on stdout is emitted as a text event; agent completion is signalled by the
 * stream's `close` event when the process exits.
 *
 * Unlike CursorStreamReader, there are no structured tool-call events —
 * CommandCode headless mode does not emit them.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// ─── Callback types ───────────────────────────────────────────────────────────

type TextCallback = (text: string) => void;
type AgentEndCallback = () => void;
type AnyEventCallback = () => void;

// ─── Implementation ───────────────────────────────────────────────────────────

export class CommandCodeStreamReader {
  private readonly textCallbacks: TextCallback[] = [];
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly anyEventCallbacks: AnyEventCallback[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      for (const cb of this.anyEventCallbacks) cb();
      for (const cb of this.textCallbacks) cb(trimmed);
    });

    stream.on('close', () => {
      for (const cb of this.agentEndCallbacks) cb();
    });
  }

  /**
   * Fires for each non-empty line received on stdout.
   * The line is trimmed of leading/trailing whitespace before delivery.
   */
  onText(cb: TextCallback): void {
    this.textCallbacks.push(cb);
  }

  /**
   * Fires for every non-blank line received, before onText callbacks.
   */
  onAnyEvent(cb: AnyEventCallback): void {
    this.anyEventCallbacks.push(cb);
  }

  /**
   * Fires exactly once when the underlying stream closes (process exited).
   * No session id is available in plain-text headless mode.
   */
  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }
}
