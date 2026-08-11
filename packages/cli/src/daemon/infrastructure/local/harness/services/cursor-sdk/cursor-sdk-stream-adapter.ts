/**
 * CursorSdkStreamAdapter — maps @cursor/sdk run.stream() SDKMessage events and
 * SendOptions.onDelta InteractionUpdate deltas to stdout log lines compatible
 * with the existing cursor CLI harness pipeline.
 */

import type { InteractionUpdate, SDKMessage } from '@cursor/sdk';

import {
  logUnhandledInteractionDelta,
  logUnhandledSdkMessage,
} from './cursor-sdk-stream-fallback.js';
import {
  BASH_TOOL_KIND,
  extractBashCommandFromToolInput,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';
import { NativeStreamAdapterBase } from '../native-stream-adapter-base.js';

type ToolCallStartedUpdate = Extract<InteractionUpdate, { type: 'tool-call-started' }>;

export class CursorSdkStreamAdapter extends NativeStreamAdapterBase {
  private textBuffer = '';

  // fallow-ignore-next-line complexity
  handleMessage(message: SDKMessage): void {
    this.notifyOutput();

    switch (message.type) {
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'tool_call': {
        this.flushText();
        if (message.status === 'error') {
          const detail =
            message.result !== undefined ? JSON.stringify(message.result) : 'no result';
          this.writeLine(
            formatAgentLogLine(
              this.logPrefix,
              'tool-error',
              `${message.name} (${message.call_id}): ${detail}`
            )
          );
          break;
        }
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
      case 'status': {
        const payload = message.message ? `${message.status}: ${message.message}` : message.status;
        this.writeLine(formatAgentLogLine(this.logPrefix, 'status', payload));
        break;
      }
      case 'thinking':
        // Thinking streams via thinking-delta (onDelta) since SDK 1.0.24+.
        // run.stream() thinking SDKMessages duplicate the same content.
        break;
      case 'system':
        if (message.subtype === 'init') {
          this.writeLine(formatAgentLogLine(this.logPrefix, 'system: init'));
        }
        break;
      case 'task':
        this.writeLine(
          formatAgentLogLine(
            this.logPrefix,
            'task',
            [message.status, message.text].filter(Boolean).join(': ')
          )
        );
        break;
      case 'usage':
        // Per-turn token usage at turn end — informational only, not agent output.
        break;
      case 'user':
      case 'request':
        // Echo/internal protocol messages — informational, not agent output.
        logUnhandledSdkMessage(this.logPrefix, message, (line) => this.writeLine(line));
        break;
      default:
        logUnhandledSdkMessage(this.logPrefix, message, (line) => this.writeLine(line));
        break;
    }
  }

  /**
   * Handle an InteractionUpdate delta delivered via SendOptions.onDelta.
   * Deltas are the primary stream for text/tool progress in SDK 1.0.24+;
   * run.stream() SDKMessages remain for terminal status/tool_call records.
   */
  // fallow-ignore-next-line complexity
  handleInteractionDelta(update: InteractionUpdate): void {
    this.notifyOutput();
    switch (update.type) {
      case 'text-delta':
        this.appendAssistantText(update.text);
        break;
      case 'thinking-delta':
        this.writeLine(formatAgentLogLine(this.logPrefix, 'thinking', update.text));
        break;
      case 'tool-call-started':
        this.flushText();
        this.logToolCallStarted(update);
        break;
      case 'tool-call-completed':
        this.flushText();
        // informational — existing tool_call SDKMessage handles detailed status
        break;
      case 'tool-call-delta':
        this.handleToolCallDelta(update);
        break;
      case 'turn-ended':
      case 'thinking-completed':
      case 'token-delta':
      case 'summary-started':
      case 'summary-completed':
      case 'summary':
      case 'user-message-appended':
      case 'partial-tool-call':
      case 'shell-output-delta':
      case 'step-started':
      case 'step-completed':
        // intentionally silent — informational / handled elsewhere
        break;
      default:
        logUnhandledInteractionDelta(this.logPrefix, update, (line) => this.writeLine(line));
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
        this.appendAssistantText(block.text);
      }
    }
  }

  private appendAssistantText(text: string): void {
    this.textBuffer += text;
    this.assistantTextCapture.captureAssistantText(text);
    if (this.textBuffer.includes('\n')) this.flushText();
  }

  // fallow-ignore-next-line complexity
  private handleToolCallDelta(
    update: Extract<InteractionUpdate, { type: 'tool-call-delta' }>
  ): void {
    const nested = update.taskUpdate;
    switch (nested.type) {
      case 'text-delta':
        this.appendAssistantText(nested.text);
        break;
      case 'tool-call-started':
        this.flushText();
        this.logToolCallStarted(nested);
        break;
      case 'tool-call-completed':
      case 'thinking-delta':
      case 'thinking-completed':
      case 'partial-tool-call':
      case 'step-started':
      case 'step-completed':
        // informational — handled via top-level updates or elsewhere
        break;
      default:
        logUnhandledInteractionDelta(
          this.logPrefix,
          nested as unknown as InteractionUpdate,
          (line) => this.writeLine(line)
        );
    }
  }

  // fallow-ignore-next-line complexity
  private logToolCallStarted(update: ToolCallStartedUpdate): void {
    const toolCall = update.toolCall;
    const command = toolCall.type === 'shell' ? toolCall.args?.command : undefined;
    if (command) {
      this.writeLine(
        formatAgentLogLine(this.logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(command))
      );
      return;
    }
    this.writeLine(
      formatAgentLogLine(
        this.logPrefix,
        `tool: ${update.callId} ${toolCall.type}`,
        JSON.stringify(toolCall.args ?? {})
      )
    );
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

  protected override writeLine(formatted: string): void {
    this.emitLogLine?.(formatted);
    this.emitLogLine?.(formatted);
  }
}
