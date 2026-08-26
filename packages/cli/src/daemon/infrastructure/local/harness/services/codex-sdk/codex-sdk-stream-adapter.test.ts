import type { ThreadEvent } from '@openai/codex-sdk';
import { describe, expect, it, vi } from 'vitest';

import { CodexSdkStreamAdapter } from './codex-sdk-stream-adapter.js';

describe('CodexSdkStreamAdapter', () => {
  function createAdapter() {
    const onLogLine = vi.fn();
    const adapter = new CodexSdkStreamAdapter('[codex-sdk:builder', onLogLine);
    return { adapter, onLogLine };
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
