/**
 * ClaudeSdkStreamAdapter — maps @anthropic-ai/claude-agent-sdk SDKMessage stream to
 * daemon log lines compatible with other native SDK harnesses.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  BASH_TOOL_KIND,
  formatAgentLogLine,
  formatBashRunningPayload,
  resolveBashCommandForLog,
} from '../agent-log-format.js';
import { NativeStreamAdapterBase } from '../native-stream-adapter-base.js';

export class ClaudeSdkStreamAdapter extends NativeStreamAdapterBase {
  private textBuffer = '';
  private thinkingBuffer = '';

  // fallow-ignore-next-line complexity
  handleMessage(message: SDKMessage): void {
    this.notifyOutput();

    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message);
        break;
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'user':
        this.handleUser(message);
        break;
      case 'system':
        if (message.subtype === 'init') {
          this.writeLine(formatAgentLogLine(this.logPrefix, 'system: init'));
        }
        break;
      case 'result':
        if (message.is_error) {
          const errors =
            'errors' in message && Array.isArray(message.errors)
              ? message.errors.join('; ')
              : 'turn failed';
          this.writeLine(formatAgentLogLine(this.logPrefix, 'run-error', errors));
        }
        break;
      default:
        break;
    }
  }

  /** Flush buffered output and emit agent_end once per turn. */
  finish(): void {
    this.flushText();
    this.flushThinking();
    this.emitAgentEnd();
  }

  private handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const event = message.event;
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        this.appendText(delta.text);
      } else if (delta.type === 'thinking_delta') {
        this.appendThinking(delta.thinking);
      }
    }
  }

  // fallow-ignore-next-line complexity
  private handleAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    if (message.error) {
      this.writeLine(
        formatAgentLogLine(this.logPrefix, 'run-error', `assistant error: ${message.error}`)
      );
    }

    for (const block of message.message.content) {
      if (block.type === 'text') {
        this.appendText(block.text);
        this.flushText();
      } else if (block.type === 'thinking') {
        this.appendThinking(block.thinking);
        this.flushThinking();
      } else if (block.type === 'tool_use') {
        this.flushText();
        this.flushThinking();
        const bashCmd = resolveBashCommandForLog(block.name, block.input);
        if (bashCmd !== null) {
          this.writeLine(
            formatAgentLogLine(this.logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd))
          );
          break;
        }
        const argsStr = block.input != null ? ` args: ${JSON.stringify(block.input)}` : '';
        this.writeLine(formatAgentLogLine(this.logPrefix, 'tool', `${block.name}${argsStr}`));
      }
    }
  }

  // fallow-ignore-next-line complexity
  private handleUser(message: Extract<SDKMessage, { type: 'user' }>): void {
    if (message.tool_use_result === undefined) return;

    const content = message.message.content;
    const blocks = Array.isArray(content) ? content : [content];
    for (const block of blocks) {
      if (typeof block === 'string') continue;
      if (block.type === 'tool_result') {
        const resultStr =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        this.writeLine(
          formatAgentLogLine(this.logPrefix, 'tool_result', `tool result: ${resultStr}`)
        );
      }
    }
  }

  private emitAgentEnd(): void {
    if (this.agentEndEmitted) return;
    this.agentEndEmitted = true;
    this.writeLine(formatAgentLogLine(this.logPrefix, 'agent_end'));
    for (const cb of this.agentEndCallbacks) cb();
  }

  private appendText(delta: string): void {
    this.flushThinking();
    this.textBuffer += delta;
    this.assistantTextCapture.captureAssistantText(delta);
    if (this.textBuffer.includes('\n')) this.flushText();
  }

  private appendThinking(delta: string): void {
    this.flushText();
    this.thinkingBuffer += delta;
    if (this.thinkingBuffer.includes('\n')) this.flushThinking();
  }

  // fallow-ignore-next-line complexity
  private flushText(): void {
    if (!this.textBuffer) return;
    const lines = this.textBuffer.split('\n');
    const remaining = this.textBuffer.endsWith('\n') ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (line.length > 0) {
        this.writeLine(formatAgentLogLine(this.logPrefix, 'text', line));
      }
    }
    this.textBuffer = remaining;
  }

  // fallow-ignore-next-line complexity
  private flushThinking(): void {
    if (!this.thinkingBuffer) return;
    const lines = this.thinkingBuffer.split('\n');
    const remaining = this.thinkingBuffer.endsWith('\n') ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (line.length > 0) {
        this.writeLine(formatAgentLogLine(this.logPrefix, 'thinking', line));
      }
    }
    this.thinkingBuffer = remaining;
  }

  protected override writeLine(line: string): void {
    process.stderr.write(`${line}\n`);
    this.emitLogLine?.(line);
  }
}
