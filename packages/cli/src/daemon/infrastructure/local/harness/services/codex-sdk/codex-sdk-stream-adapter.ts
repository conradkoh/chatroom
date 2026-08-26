/**
 * CodexSdkStreamAdapter — maps @openai/codex-sdk ThreadEvent events to stdout
 * log lines compatible with the existing native SDK harness pipeline.
 */

import type {
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  ReasoningItem,
  ThreadEvent,
  ThreadItem,
  WebSearchItem,
} from '@openai/codex-sdk';

import {
  classifyProviderErrorMessage,
  providerUnavailableAgentEndReason,
} from '../../../../../domain/usecase/classify-provider-error.js';
import {
  BASH_TOOL_KIND,
  formatAgentLogLine,
  formatBashRunningPayload,
} from '../agent-log-format.js';
import { NativeStreamAdapterBase } from '../native-stream-adapter-base.js';

export class CodexSdkStreamAdapter extends NativeStreamAdapterBase {
  private textBuffer = '';

  /**
   * Handle one top-level ThreadEvent from `runStreamed()`. Item lifecycle
   * events carry the item payload; turn-level events are informational except
   * for turn failures.
   */
  // fallow-ignore-next-line complexity
  handleEvent(event: ThreadEvent): void {
    this.notifyOutput();

    switch (event.type) {
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItem(event.item);
        break;
      case 'turn.completed':
        // Token usage only — no agent output.
        break;
      case 'turn.failed':
        this.flushText();
        this.writeProviderUnavailableMarker(event.error.message);
        this.writeLine(formatAgentLogLine(this.logPrefix, 'run-error', event.error.message));
        break;
      case 'error':
        // Fatal stream error.
        this.flushText();
        this.writeProviderUnavailableMarker(event.message);
        this.writeLine(formatAgentLogLine(this.logPrefix, 'run-error', event.message));
        break;
      case 'thread.started':
      case 'turn.started':
      default:
        // Structural events — handled by the turn loop, not logged as output.
        break;
    }
  }

  /** Call when the turn stream finishes so lifecycle.turn.completed is emitted. */
  finish(): void {
    this.flushText();
    this.emitAgentEnd();
  }

  // fallow-ignore-next-line complexity
  private handleItem(item: ThreadItem): void {
    switch (item.type) {
      case 'agent_message':
        this.appendAssistantText(item.text);
        break;
      case 'reasoning':
        this.logReasoning(item);
        break;
      case 'command_execution':
        this.logCommandExecution(item);
        break;
      case 'file_change':
        this.logFileChange(item);
        break;
      case 'mcp_tool_call':
        this.logMcpToolCall(item);
        break;
      case 'web_search':
        this.logWebSearch(item);
        break;
      case 'error':
        this.flushText();
        this.writeLine(formatAgentLogLine(this.logPrefix, 'error', item.message));
        break;
      case 'todo_list':
        // Informational plan state — not agent output.
        break;
      default:
        break;
    }
  }

  private logReasoning(item: ReasoningItem): void {
    this.flushText();
    this.writeLine(formatAgentLogLine(this.logPrefix, 'thinking', item.text));
  }

  // fallow-ignore-next-line complexity
  private logCommandExecution(item: CommandExecutionItem): void {
    this.flushText();
    this.writeLine(
      formatAgentLogLine(this.logPrefix, BASH_TOOL_KIND, formatBashRunningPayload(item.command))
    );
    if (item.aggregated_output && item.aggregated_output.trim().length > 0) {
      this.writeLine(formatAgentLogLine(this.logPrefix, 'tool-output', item.aggregated_output));
    }
    if (item.status === 'failed') {
      this.writeLine(
        formatAgentLogLine(
          this.logPrefix,
          'tool-error',
          `${item.command} exited with ${item.exit_code ?? 'unknown'}`
        )
      );
    }
  }

  private logFileChange(item: FileChangeItem): void {
    this.flushText();
    const summary = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ');
    this.writeLine(
      formatAgentLogLine(
        this.logPrefix,
        'file',
        `${summary}${item.status === 'failed' ? ' (patch failed)' : ''}`
      )
    );
  }

  // fallow-ignore-next-line complexity
  private logMcpToolCall(item: McpToolCallItem): void {
    this.flushText();
    if (item.status === 'failed' || item.error) {
      this.writeLine(
        formatAgentLogLine(
          this.logPrefix,
          'tool-error',
          `${item.server}/${item.tool}: ${item.error?.message ?? 'failed'}`
        )
      );
      return;
    }
    this.writeLine(
      formatAgentLogLine(
        this.logPrefix,
        'tool',
        `${item.server}/${item.tool} ${JSON.stringify(item.arguments ?? {})}`
      )
    );
  }

  private logWebSearch(item: WebSearchItem): void {
    this.flushText();
    this.writeLine(formatAgentLogLine(this.logPrefix, 'tool: web_search', item.query));
  }

  private appendAssistantText(text: string): void {
    this.textBuffer += text;
    this.assistantTextCapture.captureAssistantText(text);
    if (this.textBuffer.includes('\n')) this.flushText();
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

  private writeProviderUnavailableMarker(message: string): void {
    const classification = classifyProviderErrorMessage(message);
    if (!classification) return;
    this.writeLine(
      formatAgentLogLine(
        this.logPrefix,
        'agent_end',
        `reason: ${providerUnavailableAgentEndReason(classification.reason)}`
      )
    );
  }
}
