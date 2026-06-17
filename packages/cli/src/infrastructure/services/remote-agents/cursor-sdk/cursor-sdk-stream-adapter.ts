/**
 * CursorSdkStreamAdapter — maps @cursor/sdk run.stream() SDKMessage events to
 * stdout log lines compatible with the existing cursor CLI harness pipeline.
 */

import type { SDKMessage } from '@cursor/sdk';

import {
  BASH_TOOL_KIND,
  extractBashCommandFromToolInput,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';

type AgentEndCallback = () => void;
type OutputCallback = () => void;

export class CursorSdkStreamAdapter {
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly outputCallbacks: OutputCallback[] = [];
  private agentEndEmitted = false;
  private textBuffer = '';

  constructor(
    private readonly logPrefix: string,
    private readonly emitLogLine?: (line: string) => void
  ) {}

  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  // fallow-ignore-next-line complexity
  handleMessage(message: SDKMessage): void {
    this.notifyOutput();

    switch (message.type) {
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'tool_call': {
        this.flushText();
        const bashCmd = extractBashCommandFromToolInput(message.name, message.args);
        if (bashCmd !== null) {
          this.writeLine(
            formatAgentLogLine(this.logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd))
          );
          break;
        }
        this.writeLine(
          formatAgentLogLine(
            this.logPrefix,
            `tool: ${message.call_id} ${message.name} ${JSON.stringify({ status: message.status, args: message.args })}`
          )
        );
        break;
      }
      case 'status':
        this.writeLine(formatAgentLogLine(this.logPrefix, `status: ${message.status}`));
        // Terminal statuses are logged only; agent_end is emitted from finish()
        // after run.wait() so resumeTurn is not invoked mid-stream.
        break;
      case 'thinking':
        this.writeLine(formatAgentLogLine(this.logPrefix, 'thinking', message.text));
        break;
      case 'system':
        if (message.subtype === 'init') {
          this.writeLine(formatAgentLogLine(this.logPrefix, 'system: init'));
        }
        break;
      default:
        break;
    }
  }

  /** Flush buffered assistant text without emitting agent_end. */
  flushPendingOutput(): void {
    this.flushText();
  }

  /** Call when the run completes successfully (after stream + wait). */
  finish(): void {
    this.flushText();
    this.emitAgentEnd();
  }

  private handleAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    for (const block of message.message.content) {
      if (block.type === 'text') {
        this.textBuffer += block.text;
        if (this.textBuffer.includes('\n')) {
          this.flushText();
        }
      }
    }
  }

  private flushText(): void {
    if (!this.textBuffer) return;
    for (const line of this.textBuffer.split('\n')) {
      if (line) this.writeLine(formatAgentLogLine(this.logPrefix, 'text', line));
    }
    this.textBuffer = '';
  }

  private emitAgentEnd(): void {
    if (this.agentEndEmitted) return;
    this.agentEndEmitted = true;
    this.flushText();
    this.writeLine(formatAgentLogLine(this.logPrefix, 'agent_end'));
    for (const cb of this.agentEndCallbacks) cb();
  }

  private writeLine(formatted: string): void {
    process.stdout.write(`${formatted}\n`);
    this.emitLogLine?.(formatted);
  }

  private notifyOutput(): void {
    for (const cb of this.outputCallbacks) cb();
  }
}
