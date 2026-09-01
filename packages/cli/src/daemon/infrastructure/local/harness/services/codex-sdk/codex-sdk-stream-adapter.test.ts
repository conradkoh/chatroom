import type { ThreadEvent } from '@openai/codex-sdk';
import { describe, expect, it, vi } from 'vitest';

import { CodexSdkStreamAdapter } from './codex-sdk-stream-adapter.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivitySignal,
} from '../../../../agent-process-manager/harness-activity-emitter.js';

const LOG_PREFIX = '[codex-sdk:builder';

function createAdapter() {
  const onLogLine = vi.fn();
  const emitter = createHarnessActivityEmitter();
  const signals: HarnessActivitySignal[] = [];
  emitter.onActivity((signal) => signals.push(signal));
  const adapter = new CodexSdkStreamAdapter(LOG_PREFIX, onLogLine, emitter);
  return { adapter, onLogLine, emitter, signals };
}

function itemEvent(
  type: 'item.started' | 'item.updated' | 'item.completed',
  item: Record<string, unknown>
): ThreadEvent {
  return { type, item } as unknown as ThreadEvent;
}

function getLines(onLogLine: ReturnType<typeof vi.fn>): string[] {
  return onLogLine.mock.calls.map((c) => String(c[0]));
}

function signalKinds(signals: HarnessActivitySignal[]) {
  return signals.map((s) => s.kind);
}

function signalSources(signals: HarnessActivitySignal[]) {
  return signals.map((s) => s.source);
}

describe('CodexSdkStreamAdapter', () => {
  it('logs agent message text and reasoning', () => {
    const { adapter, onLogLine } = createAdapter();

    adapter.handleEvent(
      itemEvent('item.completed', { id: 'i1', type: 'agent_message', text: 'hello\nworld' })
    );
    adapter.handleEvent(itemEvent('item.completed', { id: 'i2', type: 'reasoning', text: 'hmm' }));

    expect(getLines(onLogLine)).toContain('[codex-sdk:builder text] hello');
    expect(getLines(onLogLine)).toContain('[codex-sdk:builder text] world');
    expect(getLines(onLogLine)).toContain('[codex-sdk:builder thinking] hmm');
  });

  it('logs bash command executions and aggregated output', () => {
    const { adapter, onLogLine } = createAdapter();

    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'c1',
        type: 'command_execution',
        command: 'npm test',
        aggregated_output: 'PASS',
        status: 'completed',
      })
    );

    expect(getLines(onLogLine)).toContain('[codex-sdk:builder tool: bash] running: npm test');
    expect(getLines(onLogLine)).toContain('[codex-sdk:builder tool-output] PASS');
  });

  it('logs file changes and mcp tool calls', () => {
    const { adapter, onLogLine } = createAdapter();

    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'f1',
        type: 'file_change',
        changes: [
          { path: 'src/a.ts', kind: 'update' },
          { path: 'src/b.ts', kind: 'add' },
        ],
        status: 'completed',
      })
    );
    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'm1',
        type: 'mcp_tool_call',
        server: 'github',
        tool: 'create_issue',
        arguments: { title: 'x' },
        status: 'completed',
      })
    );

    const lines = getLines(onLogLine);
    expect(lines).toContain('[codex-sdk:builder file] update src/a.ts, add src/b.ts');
    expect(lines).toContain('[codex-sdk:builder tool] github/create_issue {"title":"x"}');
  });

  it('marks provider capacity failures with a structured agent-end reason', () => {
    const { adapter, onLogLine } = createAdapter();

    adapter.handleEvent({
      type: 'turn.failed',
      error: { message: 'Selected model is at capacity' },
    } as unknown as ThreadEvent);

    expect(getLines(onLogLine)).toContain(
      '[codex-sdk:builder agent_end] reason: provider_model_capacity'
    );
    expect(getLines(onLogLine)).toContain(
      '[codex-sdk:builder run-error] Selected model is at capacity'
    );
  });

  it('marks a turn as failed on fatal stream error events', () => {
    const { adapter, onLogLine } = createAdapter();

    adapter.handleEvent({ type: 'error', message: 'boom' } as unknown as ThreadEvent);

    expect(getLines(onLogLine)).toContain('[codex-sdk:builder run-error] boom');
  });

  it('finish emits agent_end exactly once', () => {
    const { adapter, onLogLine } = createAdapter();
    const onAgentEnd = vi.fn();
    adapter.onAgentEnd(onAgentEnd);

    adapter.finish();
    adapter.finish();

    expect(onAgentEnd).toHaveBeenCalledTimes(1);
    expect(onLogLine.mock.calls.map((c) => String(c[0]))).toContain(
      '[codex-sdk:builder agent_end]'
    );
  });
});

describe('CodexSdkStreamAdapter typed activity', () => {
  it('emits transport with codex-sdk.<event.type> for representative events', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent({ type: 'thread.started', thread_id: 't1' } as unknown as ThreadEvent);
    adapter.handleEvent({ type: 'turn.started' } as unknown as ThreadEvent);
    adapter.handleEvent(
      itemEvent('item.completed', { id: 'i1', type: 'agent_message', text: 'hi' })
    );
    adapter.handleEvent({ type: 'turn.completed', usage: {} } as unknown as ThreadEvent);

    expect(signals.filter((s) => s.kind === 'transport').map((s) => s.source)).toEqual([
      'codex-sdk.thread.started',
      'codex-sdk.turn.started',
      'codex-sdk.item.completed',
      'codex-sdk.turn.completed',
    ]);
  });

  it('emits progress for agent_message and reasoning items', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', { id: 'i1', type: 'agent_message', text: 'hello' })
    );
    adapter.handleEvent(itemEvent('item.completed', { id: 'i2', type: 'reasoning', text: 'hmm' }));

    expect(signalSources(signals)).toContain('codex-sdk.item.agent-message');
    expect(signalSources(signals)).toContain('codex-sdk.item.reasoning');
  });

  it('emits progress and waiting for in-progress command_execution', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.started', {
        id: 'c1',
        type: 'command_execution',
        command: 'npm test',
        status: 'in_progress',
      })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.command-execution').map((s) => s.kind)
    ).toEqual(['progress', 'waiting']);
  });

  it('emits progress without waiting for completed command_execution', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'c1',
        type: 'command_execution',
        command: 'npm test',
        status: 'completed',
      })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.command-execution').map((s) => s.kind)
    ).toEqual(['progress']);
  });

  it('emits progress and failure for failed file_change', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'f1',
        type: 'file_change',
        changes: [{ path: 'src/a.ts', kind: 'update' }],
        status: 'failed',
      })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.file-change').map((s) => s.kind)
    ).toEqual(['progress', 'failure']);
  });

  it('emits progress and waiting for in-progress mcp_tool_call', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.started', {
        id: 'm1',
        type: 'mcp_tool_call',
        server: 'github',
        tool: 'create_issue',
        status: 'in_progress',
      })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.mcp-tool-call').map((s) => s.kind)
    ).toEqual(['progress', 'waiting']);
  });

  it('emits progress and failure for failed mcp_tool_call', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', {
        id: 'm1',
        type: 'mcp_tool_call',
        server: 'github',
        tool: 'create_issue',
        status: 'failed',
        error: { message: 'rate limited' },
      })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.mcp-tool-call').map((s) => s.kind)
    ).toEqual(['progress', 'failure']);
  });

  it('emits progress and waiting on web_search start only', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.started', { id: 'w1', type: 'web_search', query: 'typescript generics' })
    );
    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.web-search').map((s) => s.kind)
    ).toEqual(['progress', 'waiting']);

    signals.length = 0;
    adapter.handleEvent(
      itemEvent('item.completed', { id: 'w1', type: 'web_search', query: 'typescript generics' })
    );

    expect(
      signals.filter((s) => s.source === 'codex-sdk.item.web-search').map((s) => s.kind)
    ).toEqual(['progress']);
  });

  it('emits failure without progress for item.error', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', { id: 'e1', type: 'error', message: 'item failed' })
    );

    expect(signalKinds(signals)).toEqual(['transport', 'failure']);
    expect(signalSources(signals)).toContain('codex-sdk.item.error');
  });

  it('emits failure for turn.failed and top-level error', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent({
      type: 'turn.failed',
      error: { message: 'turn failed' },
    } as unknown as ThreadEvent);
    signals.length = 0;
    adapter.handleEvent({ type: 'error', message: 'stream error' } as unknown as ThreadEvent);

    expect(signalKinds(signals)).toEqual(['transport', 'failure']);
    expect(signalSources(signals)).toContain('codex-sdk.error');
  });

  it('keeps thread/turn lifecycle and todo_list transport-only for semantics', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent({ type: 'thread.started', thread_id: 't1' } as unknown as ThreadEvent);
    adapter.handleEvent({ type: 'turn.started' } as unknown as ThreadEvent);
    adapter.handleEvent({ type: 'turn.completed', usage: {} } as unknown as ThreadEvent);
    adapter.handleEvent(itemEvent('item.updated', { id: 'todo1', type: 'todo_list', items: [] }));

    expect(signals.every((s) => s.kind === 'transport')).toBe(true);
  });

  it('never includes command, query, or error payload text in sources', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.started', {
        id: 'c1',
        type: 'command_execution',
        command: 'secret-command',
        status: 'in_progress',
      })
    );
    adapter.handleEvent(
      itemEvent('item.started', { id: 'w1', type: 'web_search', query: 'secret query' })
    );
    adapter.handleEvent({
      type: 'turn.failed',
      error: { message: 'secret failure' },
    } as unknown as ThreadEvent);

    for (const signal of signals) {
      expect(signal.source).not.toContain('secret');
      expect(signal.source).not.toContain('npm');
    }
  });

  it('finish emits agent_end without activity signals', () => {
    const { adapter, signals } = createAdapter();
    const onAgentEnd = vi.fn();
    adapter.onAgentEnd(onAgentEnd);
    adapter.finish();
    adapter.finish();

    expect(onAgentEnd).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(0);
  });

  it('beginTurn resets isFirstForTurn on the next progress signal', () => {
    const { adapter, emitter, signals } = createAdapter();
    adapter.handleEvent(
      itemEvent('item.completed', { id: 'i1', type: 'agent_message', text: 'first' })
    );
    expect(signals.find((s) => s.kind === 'progress')?.isFirstForTurn).toBe(true);

    emitter.beginTurn();
    signals.length = 0;
    adapter.handleEvent(itemEvent('item.completed', { id: 'i2', type: 'reasoning', text: 'next' }));
    expect(signals.find((s) => s.kind === 'progress')?.isFirstForTurn).toBe(true);
  });
});
