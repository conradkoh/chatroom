/**
 * CursorSdkStreamAdapter — maps @cursor/sdk run.stream() SDKMessage events to
 * stdout log lines compatible with the existing cursor CLI harness pipeline.
 */

import type { SDKMessage } from '@cursor/sdk';

type AgentEndCallback = () => void;
type OutputCallback = () => void;

export class CursorSdkStreamAdapter {
  private readonly agentEndCallbacks: AgentEndCallback[] = [];
  private readonly outputCallbacks: OutputCallback[] = [];
  private agentEndEmitted = false;
  private textBuffer = '';

  constructor(private readonly logPrefix: string) {}

  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  handleMessage(message: SDKMessage): void {
    this.notifyOutput();

    switch (message.type) {
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'tool_call':
        this.flushText();
        process.stdout.write(
          `${this.logPrefix} tool: ${message.call_id} ${message.name} ${JSON.stringify({ status: message.status, args: message.args })}]\n`
        );
        break;
      case 'status':
        process.stdout.write(`${this.logPrefix} status: ${message.status}]\n`);
        // Terminal statuses are logged only; agent_end is emitted from finish()
        // after run.wait() so resumeTurn is not invoked mid-stream.
        break;
      case 'thinking':
        process.stdout.write(`${this.logPrefix} thinking] ${message.text}\n`);
        break;
      case 'system':
        if (message.subtype === 'init') {
          process.stdout.write(`${this.logPrefix} system: init]\n`);
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
      if (line) process.stdout.write(`${this.logPrefix} text] ${line}\n`);
    }
    this.textBuffer = '';
  }

  private emitAgentEnd(): void {
    if (this.agentEndEmitted) return;
    this.agentEndEmitted = true;
    this.flushText();
    process.stdout.write(`${this.logPrefix} agent_end]\n`);
    for (const cb of this.agentEndCallbacks) cb();
  }

  private notifyOutput(): void {
    for (const cb of this.outputCallbacks) cb();
  }
}
