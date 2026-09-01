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
import type { HarnessActivityEmitter } from '../../../../agent-process-manager/harness-activity-emitter.js';
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
  private sawTextDelta = false;

  constructor(
    logPrefix: string,
    emitLogLine?: (line: string) => void,
    activityEmitter?: HarnessActivityEmitter
  ) {
    super(logPrefix, emitLogLine, activityEmitter);
  }

  // fallow-ignore-next-line complexity
  handleMessage(message: SDKMessage): void {
    this.notifyOutput('cursor-sdk.message');

    switch (message.type) {
      case 'assistant':
        this.notifyProgress('cursor-sdk.assistant');
        this.handleAssistant(message);
        break;
      case 'tool_call': {
        this.notifyProgress('cursor-sdk.tool_call');
        if (message.status === 'running') {
          this.notifyWaiting('cursor-sdk.tool_call');
        } else if (message.status === 'error') {
          this.notifyFailure('cursor-sdk.tool_call');
        }
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
        if (message.status === 'RUNNING') {
          this.notifyProgress('cursor-sdk.status');
        } else if (message.status === 'ERROR') {
          this.notifyFailure('cursor-sdk.status');
        }
        const payload = message.message ? `${message.status}: ${message.message}` : message.status;
        this.writeLine(formatAgentLogLine(this.logPrefix, 'status', payload));
        break;
      }
      case 'thinking':
        this.notifyProgress('cursor-sdk.thinking');
        // Thinking streams via thinking-delta (onDelta) since SDK 1.0.24+.
        // run.stream() thinking SDKMessages duplicate the same content.
        break;
      case 'system':
        if (message.subtype === 'init') {
          this.writeLine(formatAgentLogLine(this.logPrefix, 'system: init'));
        }
        break;
      case 'task':
        this.notifyProgress('cursor-sdk.task');
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
    this.notifyOutput('cursor-sdk.interaction');
    switch (update.type) {
      case 'text-delta':
        this.notifyProgress('cursor-sdk.interaction.text-delta');
        this.sawTextDelta = true;
        this.appendAssistantText(update.text);
        break;
      case 'thinking-delta':
        this.notifyProgress('cursor-sdk.interaction.thinking-delta');
        this.writeLine(formatAgentLogLine(this.logPrefix, 'thinking', update.text));
        break;
      case 'tool-call-started':
        this.notifyProgress('cursor-sdk.interaction.tool-call-started');
        this.notifyWaiting('cursor-sdk.interaction.tool-call-started');
        this.flushText();
        this.logToolCallStarted(update);
        break;
      case 'tool-call-completed':
        this.notifyProgress('cursor-sdk.interaction.tool-call-completed');
        this.flushText();
        // informational — existing tool_call SDKMessage handles detailed status
        break;
      case 'tool-call-delta':
        this.notifyProgress('cursor-sdk.interaction.tool-call-delta');
        this.handleToolCallDelta(update);
        break;
      case 'partial-tool-call':
        this.notifyProgress('cursor-sdk.interaction.partial-tool-call');
        break;
      case 'shell-output-delta':
        this.notifyProgress('cursor-sdk.interaction.shell-output-delta');
        break;
      case 'step-started':
        this.notifyProgress('cursor-sdk.interaction.step-started');
        break;
      case 'step-completed':
        this.notifyProgress('cursor-sdk.interaction.step-completed');
        break;
      case 'summary-started':
        this.notifyProgress('cursor-sdk.interaction.summary-started');
        break;
      case 'summary-completed':
        this.notifyProgress('cursor-sdk.interaction.summary-completed');
        break;
      case 'summary':
        this.notifyProgress('cursor-sdk.interaction.summary');
        break;
      case 'turn-ended':
      case 'thinking-completed':
      case 'token-delta':
      case 'user-message-appended':
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
    this.sawTextDelta = false;
  }

  private handleAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    for (const block of message.message.content) {
      if (block.type === 'text' && !this.sawTextDelta) {
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
        this.sawTextDelta = true;
        this.appendAssistantText(nested.text);
        break;
      case 'tool-call-started':
        this.notifyProgress('cursor-sdk.interaction.tool-call-started');
        this.notifyWaiting('cursor-sdk.interaction.tool-call-started');
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
}
