import type { InteractionUpdate, SDKMessage } from '@cursor/sdk';
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { CursorSdkStreamAdapter } from './cursor-sdk-stream-adapter.js';

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
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>;
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('writes assistant text to stdout with log prefix', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleMessage(assistantMessage('Hello world\n'));

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello world\n`);
  });

  it.each(['FINISHED', 'ERROR', 'CANCELLED'] as const)(
    'logs terminal status %s without emitting agent_end (finish() owns turn end)',
    (status) => {
      let count = 0;
      const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
      adapter.onAgentEnd(() => count++);
      adapter.handleMessage(statusMessage(status));

      expect(count).toBe(0);
      expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} status] ${status}\n`);
      expect(stdoutWriteSpy).not.toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]\n`);
    }
  );

  it('invokes onOutput for tool_call messages', () => {
    let count = 0;
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.onOutput(() => count++);
    adapter.handleMessage(toolCallMessage());

    expect(count).toBe(1);
  });

  it('writes bash/shell tool_call as a clean running: <command> line', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleMessage(bashToolCallMessage());

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: git status\n`);
    expect(stdoutWriteSpy).not.toHaveBeenCalledWith(expect.stringContaining('tool: call-2 shell'));
  });

  it('still logs non-bash tool_call as JSON (unchanged behavior)', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleMessage(toolCallMessage());

    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining(`${LOG_PREFIX} tool: call-1 read_file`)
    );
  });

  it('finish() flushes buffered text and emits agent-end', () => {
    let count = 0;
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(assistantMessage('line without newline'));
    adapter.finish();

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} text] line without newline\n`);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]\n`);
    expect(count).toBe(1);
  });

  it('calls onAgentEnd only once when finish() is invoked twice', () => {
    let count = 0;
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.onAgentEnd(() => count++);
    adapter.finish();
    adapter.finish();

    expect(count).toBe(1);
  });

  it('does not emit agent_end for duplicate terminal status messages before finish()', () => {
    let count = 0;
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(statusMessage('FINISHED'));
    adapter.handleMessage(statusMessage('FINISHED'));

    expect(count).toBe(0);
  });

  it('does not emit agent-end for non-terminal status', () => {
    let count = 0;
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.onAgentEnd(() => count++);
    adapter.handleMessage(statusMessage('RUNNING'));

    expect(count).toBe(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]\n`);
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

  it('handles text-delta interaction updates as buffered stdout text', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate(textDelta('Hello delta\n'));

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello delta\n`);
  });

  it('writes tool-call-started shell as a clean bash running line', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate(shellToolCallStarted('pnpm test'));

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: pnpm test\n`);
  });

  it('writes non-shell tool-call-started as a tool line with JSON args', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate(nonShellToolCallStarted());

    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      `${LOG_PREFIX} tool: call-4 read] {"path":"README.md"}\n`
    );
  });

  it('handles tool-call-delta with a nested text-delta as buffered stdout text', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate(toolCallDeltaWithNestedText('Nested delta\n'));

    expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} text] Nested delta\n`);
  });

  it('warns on unknown InteractionUpdate types without writing stdout lines', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate({ type: 'mystery-delta' } as unknown as InteractionUpdate);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cursor-sdk] unhandled InteractionUpdate type="mystery-delta"'),
      expect.any(String)
    );
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('silently accepts user SDKMessages without stdout or warnings', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleMessage({
      type: 'user',
      agent_id: 'agent-1',
      run_id: 'run-1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    });

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('silently accepts request SDKMessages without stdout or warnings', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleMessage({
      type: 'request',
      agent_id: 'agent-1',
      run_id: 'run-1',
      request_id: 'req-1',
    });

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns on unknown SDKMessage types and writes a stream line', () => {
    const onLogLine = vi.fn();
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX, onLogLine);
    adapter.handleMessage({ type: 'mystery-message' } as unknown as SDKMessage);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cursor-sdk] unhandled SDKMessage type="mystery-message"'),
      expect.any(String)
    );
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} stream] unhandled type: mystery-message`);
  });

  it('warns on unknown nested taskUpdate types inside tool-call-delta', () => {
    const adapter = new CursorSdkStreamAdapter(LOG_PREFIX);
    adapter.handleInteractionUpdate({
      type: 'tool-call-delta',
      callId: 'call-6',
      taskUpdate: { type: 'mystery-nested' },
    } as unknown as InteractionUpdate);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cursor-sdk] unhandled nested taskUpdate type="mystery-nested"'),
      expect.any(String)
    );
  });
});
