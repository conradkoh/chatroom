/**
 * PiSdkStreamAdapter — maps Pi SDK AgentSessionEvent stream to daemon log lines.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import {
  BASH_TOOL_KIND,
  formatAgentLogLine,
  formatBashRunningPayload,
  resolveBashCommandForLog,
} from '../agent-log-format.js';
import { NativeStreamAdapterBase } from '../native-stream-adapter-base.js';

export class PiSdkStreamAdapter extends NativeStreamAdapterBase {
  private textBuffer = '';
  private thinkingBuffer = '';

  handleEvent(event: AgentSessionEvent): void {
    this.notifyOutput();

    switch (event.type) {
      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent.type === 'text_delta') {
          this.appendText(assistantEvent.delta);
        } else if (assistantEvent.type === 'thinking_delta') {
          this.appendThinking(assistantEvent.delta);
        }
        break;
      }
      case 'tool_execution_start': {
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
      case 'agent_end':
        this.emitAgentEnd();
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

  protected override writeLine(line: string): void {
    process.stderr.write(`${line}\n`);
    this.emitLogLine?.(line);
  }
}
