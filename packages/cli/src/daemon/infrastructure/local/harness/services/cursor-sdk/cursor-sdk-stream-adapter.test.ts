import type { InteractionUpdate, SDKMessage } from '@cursor/sdk';
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { CursorSdkStreamAdapter } from './cursor-sdk-stream-adapter.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivitySignal,
} from '../../../../agent-process-manager/harness-activity-emitter.js';

const LOG_PREFIX = '[cursor-sdk:builder@test';

function assistantMessage(text: string) {
  return {
    type: 'assistant' as const,
    agent_id: 'agent-1',
    run_id: 'run-1',
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
    },
  };
}

function statusMessage(status: 'FINISHED' | 'ERROR' | 'CANCELLED' | 'RUNNING') {
  return {
    type: 'status' as const,
    agent_id: 'agent-1',
    run_id: 'run-1',
    status,
  };
}

function toolCallMessage() {
  return {
    type: 'tool_call' as const,
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: 'call-1',
    name: 'read_file',
    status: 'running' as const,
    args: { path: 'README.md' },
  };
}

function bashToolCallMessage() {
  return {
    type: 'tool_call' as const,
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: 'call-2',
    name: 'shell',
    status: 'running' as const,
    args: { command: 'git status' },
  };
}

function textDelta(text: string): InteractionUpdate {
  return { type: 'text-delta', text };
}

function thinkingDelta(text: string): InteractionUpdate {
  return { type: 'thinking-delta', text };
}

function thinkingMessage(text: string): SDKMessage {
  return {
    type: 'thinking',
    agent_id: 'agent-1',
    run_id: 'run-1',
    text,
  } as SDKMessage;
}

function shellToolCallStarted(command: string): InteractionUpdate {
  return {
    type: 'tool-call-started',
    callId: 'call-3',
    modelCallId: 'model-call-3',
    toolCall: { type: 'shell', args: { command } },
  };
}

function nonShellToolCallStarted(): InteractionUpdate {
  return {
    type: 'tool-call-started',
    callId: 'call-4',
    modelCallId: 'model-call-4',
    toolCall: { type: 'read', args: { path: 'README.md' } },
  };
}

function toolCallDeltaWithNestedText(text: string): InteractionUpdate {
  return {
    type: 'tool-call-delta',
    callId: 'call-5',
    modelCallId: 'model-call-5',
    taskUpdate: { type: 'text-delta', text },
  };
}

describe('CursorSdkStreamAdapter', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  function createAdapter() {
    const onLogLine = vi.fn();
    const emitter = createHarnessActivityEmitter();
    const signals: HarnessActivitySignal[] = [];
    emitter.onActivity((signal) => signals.push(signal));
    return {
      adapter: new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine, emitter),
      onLogLine,
      emitter,
      signals,
    };
  }

  function signalKinds(signals: HarnessActivitySignal[]) {
    return signals.map((s) => s.kind);
  }

  function signalSources(signals: HarnessActivitySignal[]) {
    return signals.map((s) => s.source);
  }

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('writes assistant text to stdout with log prefix', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleMessage(assistantMessage('Hello world\n'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello world`);
  });

  it.each(['FINISHED', 'ERROR', 'CANCELLED'] as const)(
    'logs terminal status %s without emitting agent_end (finish() owns turn end)',
    (status) => {
      let count = 0;
      const { adapter, onLogLine } = createAdapter();
      adapter.onAgentEnd(() => count++);
      adapter.handleMessage(statusMessage(status));

      expect(count).toBe(0);
      expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} status] ${status}`);
      expect(onLogLine).not.toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]`);
    }
  );

  it('invokes onOutput for tool_call messages', () => {
    let count = 0;
    const { adapter } = createAdapter();
    adapter.onOutput(() => count++);
    adapter.handleMessage(toolCallMessage());

    expect(count).toBe(1);
  });

  it('writes bash/shell tool_call as a clean running: <command> line', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleMessage(bashToolCallMessage());

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: git status`);
    expect(onLogLine).not.toHaveBeenCalledWith(expect.stringContaining('tool: call-2 shell'));
  });

  it('still logs non-bash tool_call as JSON (unchanged behavior)', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleMessage(toolCallMessage());

    expect(onLogLine).toHaveBeenCalledWith(
      expect.stringContaining(`${LOG_PREFIX} tool: call-1 read_file`)
    );
  });

  it('finish() flushes buffered text and emits agent-end', () => {
    let count = 0;
    const { adapter, onLogLine } = createAdapter();
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(assistantMessage('line without newline'));
    adapter.finish();

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] line without newline`);
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]`);
    expect(count).toBe(1);
  });

  it('calls onAgentEnd only once when finish() is invoked twice', () => {
    let count = 0;
    const { adapter } = createAdapter();
    adapter.onAgentEnd(() => count++);
    adapter.finish();
    adapter.finish();

    expect(count).toBe(1);
  });

  it('does not emit agent_end for duplicate terminal status messages before finish()', () => {
    let count = 0;
    const { adapter } = createAdapter();
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(statusMessage('FINISHED'));
    adapter.handleMessage(statusMessage('FINISHED'));

    expect(count).toBe(0);
  });

  it('does not emit agent-end for non-terminal status', () => {
    let count = 0;
    const { adapter, onLogLine } = createAdapter();
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(statusMessage('RUNNING'));

    expect(count).toBe(0);
    expect(onLogLine).not.toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]`);
  });

  it('invokes onLogLine for formatted stdout lines', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage(statusMessage('ERROR'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} status] ERROR`);
  });

  it('logs tool_call status error with result detail', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'tool_call',
      agent_id: 'agent-1',
      run_id: 'run-1',
      call_id: 'call-1',
      name: 'shell',
      status: 'error',
      args: { command: 'curl example.com' },
      result: { blocked: 'network' },
    });

    expect(onLogLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} tool-error] shell (call-1): {"blocked":"network"}`
    );
  });

  it('logs status ERROR with message text', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'status',
      agent_id: 'agent-1',
      run_id: 'run-1',
      status: 'ERROR',
      message: 'sandbox policy violation',
    });

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} status] ERROR: sandbox policy violation`);
  });

  it('logs task messages', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'task',
      agent_id: 'agent-1',
      run_id: 'run-1',
      status: 'in_progress',
      text: 'Running tests',
    });

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} task] in_progress: Running tests`);
  });

  it('silently ignores usage messages at turn end', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'usage',
      agent_id: 'agent-1',
      run_id: 'run-1',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
      },
    });

    expect(onLogLine).not.toHaveBeenCalled();
  });

  it('logs thinking-delta interaction updates', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(thinkingDelta('planning step'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} thinking] planning step`);
  });

  it('does not duplicate thinking when both thinking-delta and thinking SDKMessage fire', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(thinkingDelta('working directory is'));
    adapter.handleMessage(thinkingMessage('working directory is'));

    expect(onLogLine).toHaveBeenCalledTimes(1);
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} thinking] working directory is`);
  });

  it('silently ignores thinking SDKMessage alone (delta path is canonical)', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleMessage(thinkingMessage('orphan thinking'));

    expect(onLogLine).not.toHaveBeenCalled();
  });

  it('handles text-delta interaction updates as buffered stdout text', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(textDelta('Hello delta\n'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello delta`);
  });

  it('does not duplicate text when both text-delta and assistant SDKMessage fire', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(textDelta('Hello world\n'));
    adapter.handleMessage(assistantMessage('Hello world\n'));

    expect(onLogLine).toHaveBeenCalledTimes(1);
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello world`);
  });

  it('emits assistant text when no text-delta arrives (fallback path)', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleMessage(assistantMessage('Fallback only\n'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Fallback only`);
  });

  it('writes tool-call-started shell as a clean bash running line', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(shellToolCallStarted('pnpm test'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: pnpm test`);
  });

  it('writes non-shell tool-call-started as a tool line with JSON args', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(nonShellToolCallStarted());

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} tool: call-4 read] {"path":"README.md"}`);
  });

  it('handles tool-call-delta with a nested text-delta as buffered stdout text', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleInteractionDelta(toolCallDeltaWithNestedText('Nested delta\n'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Nested delta`);
  });

  it('logs unknown InteractionUpdate types as delta:unhandled without throwing', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleInteractionDelta({ type: 'mystery-delta' } as unknown as InteractionUpdate);

    expect(onLogLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} delta:unhandled] mystery-delta: {"type":"mystery-delta"}`
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs user SDKMessages as stream:unhandled without throwing', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'user',
      agent_id: 'agent-1',
      run_id: 'run-1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    });

    expect(onLogLine).toHaveBeenCalledWith(
      expect.stringContaining(`${LOG_PREFIX} stream:unhandled] user: {"type":"user"`)
    );
  });

  it('logs request SDKMessages as stream:unhandled without throwing', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({
      type: 'request',
      agent_id: 'agent-1',
      run_id: 'run-1',
      request_id: 'req-1',
    });

    expect(onLogLine).toHaveBeenCalledWith(
      expect.stringContaining(`${LOG_PREFIX} stream:unhandled] request: {"type":"request"`)
    );
  });

  it('logs unknown SDKMessage types as stream:unhandled without throwing', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({ type: 'mystery-message' } as unknown as SDKMessage);

    expect(onLogLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} stream:unhandled] mystery-message: {"type":"mystery-message"}`
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs unknown nested taskUpdate types inside tool-call-delta as unhandled', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleInteractionDelta({
      type: 'tool-call-delta',
      callId: 'call-6',
      taskUpdate: { type: 'mystery-nested' },
    } as unknown as InteractionUpdate);

    expect(onLogLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} delta:unhandled] mystery-nested: {"type":"mystery-nested"}`
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe('typed activity signals', () => {
    it('emits transport for every handled SDK message', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage(assistantMessage('hello\n'));

      expect(signalKinds(signals)).toContain('transport');
      expect(signalSources(signals)).toContain('cursor-sdk.message');
    });

    it('emits progress for assistant messages', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage(assistantMessage('hello\n'));

      expect(signalSources(signals)).toContain('cursor-sdk.assistant');
      expect(signals.find((s) => s.source === 'cursor-sdk.assistant')?.kind).toBe('progress');
    });

    it('emits progress and waiting for running tool_call', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage(toolCallMessage());

      expect(signalSources(signals)).toContain('cursor-sdk.tool_call');
      expect(signals.filter((s) => s.source === 'cursor-sdk.tool_call').map((s) => s.kind)).toEqual(
        ['progress', 'waiting']
      );
    });

    it('emits progress and failure for error tool_call', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage({
        type: 'tool_call',
        agent_id: 'agent-1',
        run_id: 'run-1',
        call_id: 'call-1',
        name: 'shell',
        status: 'error',
        args: { command: 'curl example.com' },
        result: { blocked: 'network' },
      });

      const toolSignals = signals.filter((s) => s.source === 'cursor-sdk.tool_call');
      expect(toolSignals.map((s) => s.kind)).toEqual(['progress', 'failure']);
    });

    it('emits progress for RUNNING status and failure for ERROR status', () => {
      const { adapter: runningAdapter, signals: runningSignals } = createAdapter();
      runningAdapter.handleMessage(statusMessage('RUNNING'));
      expect(
        runningSignals.some((s) => s.source === 'cursor-sdk.status' && s.kind === 'progress')
      ).toBe(true);

      const { adapter: errorAdapter, signals: errorSignals } = createAdapter();
      errorAdapter.handleMessage(statusMessage('ERROR'));
      expect(
        errorSignals.some((s) => s.source === 'cursor-sdk.status' && s.kind === 'failure')
      ).toBe(true);
    });

    it('does not emit semantic signals for FINISHED or CANCELLED status', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage(statusMessage('FINISHED'));
      adapter.handleMessage(statusMessage('CANCELLED'));

      expect(signals.every((s) => s.kind === 'transport')).toBe(true);
    });

    it('emits transport only for system init and usage messages', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleMessage({
        type: 'system',
        agent_id: 'agent-1',
        run_id: 'run-1',
        subtype: 'init',
      } as SDKMessage);
      adapter.handleMessage({
        type: 'usage',
        agent_id: 'agent-1',
        run_id: 'run-1',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
      });

      expect(signals.every((s) => s.kind === 'transport')).toBe(true);
    });

    it('emits transport for interaction deltas and progress for text-delta', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleInteractionDelta(textDelta('hello\n'));

      expect(signalSources(signals)).toContain('cursor-sdk.interaction');
      expect(signalSources(signals)).toContain('cursor-sdk.interaction.text-delta');
      expect(signals.find((s) => s.source === 'cursor-sdk.interaction.text-delta')?.kind).toBe(
        'progress'
      );
    });

    it('emits progress and waiting for tool-call-started interaction', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleInteractionDelta(shellToolCallStarted('pnpm test'));

      expect(
        signals
          .filter((s) => s.source === 'cursor-sdk.interaction.tool-call-started')
          .map((s) => s.kind)
      ).toEqual(['progress', 'waiting']);
    });

    it('emits transport only for turn-ended and user-message-appended', () => {
      const { adapter, signals } = createAdapter();
      adapter.handleInteractionDelta({ type: 'turn-ended' } as InteractionUpdate);
      adapter.handleInteractionDelta({ type: 'user-message-appended' } as InteractionUpdate);

      expect(signals.every((s) => s.kind === 'transport')).toBe(true);
    });
  });
});
