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

describe('CursorSdkStreamAdapter', () => {
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
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
      expect(stdoutWriteSpy).toHaveBeenCalledWith(`${LOG_PREFIX} status: ${status}]\n`);
      expect(stdoutWriteSpy).not.toHaveBeenCalledWith(`${LOG_PREFIX} agent_end]\n`);
    }
  );

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

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} status: ERROR]`);
  });
});
