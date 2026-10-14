/**
 * PiSdkStreamAdapter — maps Pi SDK AgentSessionEvent stream to daemon log lines.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { HarnessActivityEmitter } from '../../../../../services/service-interfaces.js';
import {
  BASH_TOOL_KIND,
  formatAgentLogLine,
  formatBashRunningPayload,
  resolveBashCommandForLog,
} from '../agent-log-format.js';
import { NativeStreamAdapterBase } from '../native-stream-adapter-base.js';

type MessageEndEvent = Extract<AgentSessionEvent, { type: 'message_end' }>;

export class PiSdkStreamAdapter extends NativeStreamAdapterBase {
  private textBuffer = '';
  private thinkingBuffer = '';
  /**
   * Provider error of the most recent assistant message, or undefined when it succeeded.
   * The run's terminal decision is deferred to agent end because the SDK may auto-retry a
   * retryable error and succeed; only the final assistant message decides failed vs completed.
   */
  private lastAssistantError: string | undefined;

  constructor(
    logPrefix: string,
    emitLogLine?: (line: string) => void,
    activityEmitter?: HarnessActivityEmitter
  ) {
    super(logPrefix, emitLogLine, activityEmitter);
  }

  handleEvent(event: AgentSessionEvent): void {
    this.notifyOutput(`pi-sdk.${event.type}`);

    switch (event.type) {
      case 'message_update': {
        this.notifyProgress(`pi-sdk.message.${event.assistantMessageEvent.type}`);
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent.type === 'text_delta') {
          this.appendText(assistantEvent.delta);
        } else if (assistantEvent.type === 'thinking_delta') {
          this.appendThinking(assistantEvent.delta);
        }
        break;
      }
      case 'tool_execution_start': {
        this.notifyProgress('pi-sdk.tool_execution_start');
        this.notifyWaiting('pi-sdk.tool_execution_start');
        this.flushText();
        this.flushThinking();
        const bashCmd = resolveBashCommandForLog(event.toolName, event.args);
        if (bashCmd !== null) {
          this.writeLine(
            formatAgentLogLine(this.logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(bashCmd))
          );
          break;
        }
        const argsStr = event.args != null ? ` args: ${JSON.stringify(event.args)}` : '';
        this.writeLine(formatAgentLogLine(this.logPrefix, 'tool', `${event.toolName}${argsStr}`));
        break;
      }
      case 'tool_execution_end': {
        this.notifyProgress('pi-sdk.tool_execution_end');
        if (event.isError === true) {
          this.notifyFailure('pi-sdk.tool_execution_end');
        }
        const resultStr =
          typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        this.writeLine(
          formatAgentLogLine(
            this.logPrefix,
            'tool_result',
            `${event.toolName} result: ${resultStr}`
          )
        );
        break;
      }
      case 'message_end':
        this.recordAssistantOutcome(event);
        break;
      case 'agent_end':
        // The SDK is about to retry a retryable error; a later agent_end settles the turn.
        if (event.willRetry) break;
        this.settleRun('pi-sdk.agent_end');
        break;
      default:
        break;
    }
  }

  /** Records whether the latest assistant message failed. A provider error is logged now and settled at run end. */
  private recordAssistantOutcome(event: MessageEndEvent): void {
    const message = event.message;
    if (message.role !== 'assistant') return;
    this.lastAssistantError =
      message.stopReason === 'error'
        ? (message.errorMessage ?? 'unknown provider error')
        : undefined;
    if (this.lastAssistantError === undefined) return;
    this.notifyFailure('pi-sdk.message_end.error');
    this.writeLine(
      formatAgentLogLine(this.logPrefix, 'run-error', `assistant error: ${this.lastAssistantError}`)
    );
  }

  /**
   * Settles the turn when the prompt promise resolves. Covers runs where no terminal agent_end
   * settled it first. The first terminal result wins, so this never overwrites a failure.
   */
  settleResolvedPrompt(): void {
    this.settleRun('pi-sdk.prompt.resolved');
  }

  /** Flush buffered output after the terminal result has been recorded. */
  finish(): void {
    this.flushText();
    this.flushThinking();
  }

  private settleRun(source: string): void {
    if (this.lastAssistantError !== undefined) {
      this.completeTurn({ status: 'failed', source, error: this.lastAssistantError });
    } else {
      this.completeTurn({ status: 'completed', source });
    }
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
