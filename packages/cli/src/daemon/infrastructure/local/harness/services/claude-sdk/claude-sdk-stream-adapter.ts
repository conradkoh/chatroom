/**
 * ClaudeSdkStreamAdapter — maps @anthropic-ai/claude-agent-sdk SDKMessage stream to
 * daemon log lines compatible with other native SDK harnesses.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { HarnessActivityEmitter } from '../../../../agent-process-manager/harness-activity-emitter.js';
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

  constructor(
    logPrefix: string,
    emitLogLine?: (line: string) => void,
    activityEmitter?: HarnessActivityEmitter
  ) {
    super(logPrefix, emitLogLine, activityEmitter);
  }

  // fallow-ignore-next-line complexity
  handleMessage(message: SDKMessage): void {
    this.notifyOutput('claude-sdk.message');

    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message);
        break;
      case 'assistant':
        this.notifyProgress('claude-sdk.assistant');
        if (message.error) {
          this.notifyFailure('claude-sdk.assistant');
        }
        this.handleAssistant(message);
        break;
      case 'user':
        this.handleUser(message);
        break;
      case 'system':
        this.handleSystem(message);
        break;
      case 'result':
        if (message.is_error) {
          this.notifyFailure('claude-sdk.result');
          const errors =
            'errors' in message && Array.isArray(message.errors)
              ? message.errors.join('; ')
              : 'turn failed';
          this.writeLine(formatAgentLogLine(this.logPrefix, 'run-error', errors));
        }
        break;
      case 'tool_progress':
        this.notifyProgress('claude-sdk.tool-progress');
        this.notifyWaiting('claude-sdk.tool-progress');
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

  // fallow-ignore-next-line complexity
  private handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const event = message.event;
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        this.notifyProgress('claude-sdk.stream.text-delta');
        this.appendText(delta.text);
      } else if (delta.type === 'thinking_delta') {
        this.notifyProgress('claude-sdk.stream.thinking-delta');
        this.appendThinking(delta.thinking);
      } else if (delta.type === 'input_json_delta') {
        this.notifyProgress('claude-sdk.stream.tool-input');
        this.notifyWaiting('claude-sdk.stream.tool-input');
      }
      return;
    }
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block.type === 'tool_use') {
        this.notifyProgress('claude-sdk.stream.tool-use');
        this.notifyWaiting('claude-sdk.stream.tool-use');
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
        this.notifyWaiting('claude-sdk.assistant.tool-use');
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
        this.notifyProgress('claude-sdk.user.tool-result');
        if (block.is_error === true) {
          this.notifyFailure('claude-sdk.user.tool-result');
        }
        const resultStr =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        this.writeLine(
          formatAgentLogLine(this.logPrefix, 'tool_result', `tool result: ${resultStr}`)
        );
      }
    }
  }

  // fallow-ignore-next-line complexity
  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
    switch (message.subtype) {
      case 'init':
        this.writeLine(formatAgentLogLine(this.logPrefix, 'system: init'));
        break;
      case 'task_started':
      case 'task_progress':
        this.notifyProgress('claude-sdk.task-progress');
        this.notifyWaiting('claude-sdk.task-progress');
        break;
      case 'task_updated':
        this.notifyProgress('claude-sdk.task-progress');
        break;
      case 'permission_denied':
        this.notifyFailure('claude-sdk.permission-denied');
        break;
      default:
        break;
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
}
