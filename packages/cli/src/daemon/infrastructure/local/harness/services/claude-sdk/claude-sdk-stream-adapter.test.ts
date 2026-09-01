import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeSdkStreamAdapter } from './claude-sdk-stream-adapter.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivitySignal,
} from '../../../../agent-process-manager/harness-activity-emitter.js';

const LOG_PREFIX = '[claude-sdk:builder@test';

function createAdapter() {
  const onLogLine = vi.fn();
  const emitter = createHarnessActivityEmitter();
  const signals: HarnessActivitySignal[] = [];
  emitter.onActivity((signal) => signals.push(signal));
  return {
    adapter: new ClaudeSdkStreamAdapter(LOG_PREFIX, onLogLine, emitter),
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

describe('ClaudeSdkStreamAdapter typed activity', () => {
  it('emits transport and progress for assistant text blocks', () => {
    const { adapter, signals, onLogLine } = createAdapter();
    adapter.handleMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello\n' }] },
    } as SDKMessage);

    expect(signalSources(signals)).toContain('claude-sdk.message');
    expect(signalSources(signals)).toContain('claude-sdk.assistant');
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello`);
  });

  it('emits progress for stream text and thinking deltas', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi\n' } },
    } as SDKMessage);
    adapter.handleMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'plan\n' },
      },
    } as SDKMessage);

    expect(signalSources(signals)).toContain('claude-sdk.stream.text-delta');
    expect(signalSources(signals)).toContain('claude-sdk.stream.thinking-delta');
  });

  it('emits progress and waiting for stream tool input and tool-use start', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
    } as SDKMessage);
    adapter.handleMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tool-1', name: 'bash', input: {} },
      },
    } as SDKMessage);

    expect(
      signals.filter((s) => s.source === 'claude-sdk.stream.tool-input').map((s) => s.kind)
    ).toEqual(['progress', 'waiting']);
    expect(
      signals.filter((s) => s.source === 'claude-sdk.stream.tool-use').map((s) => s.kind)
    ).toEqual(['progress', 'waiting']);
    for (const signal of signals) {
      expect(signal.source).not.toContain('bash');
      expect(signal.source).not.toContain('{}');
    }
  });

  it('emits waiting for assistant tool_use and preserves tool log', () => {
    const { adapter, signals, onLogLine } = createAdapter();
    adapter.handleMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'ls' } }],
      },
    } as SDKMessage);

    expect(signalSources(signals)).toContain('claude-sdk.assistant.tool-use');
    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: ls`);
  });

  it('emits progress for successful user tool_result', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'user',
      tool_use_result: { ok: true },
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }],
      },
    } as SDKMessage);

    expect(signalSources(signals)).toContain('claude-sdk.user.tool-result');
    expect(signalKinds(signals)).not.toContain('failure');
  });

  it('emits progress and failure for error user tool_result', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'user',
      tool_use_result: { ok: false },
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'failed', is_error: true },
        ],
      },
    } as SDKMessage);

    expect(
      signals.filter((s) => s.source === 'claude-sdk.user.tool-result').map((s) => s.kind)
    ).toEqual(['progress', 'failure']);
  });

  it('emits failure for failed result without progress', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'result',
      is_error: true,
      errors: ['turn failed'],
    } as SDKMessage);

    expect(signalKinds(signals)).toEqual(['transport', 'failure']);
  });

  it('keeps successful result transport-only', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({
      type: 'result',
      is_error: false,
    } as SDKMessage);

    expect(signals.every((s) => s.kind === 'transport')).toBe(true);
  });

  it('keeps system init and unclassified messages transport-only', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleMessage({ type: 'system', subtype: 'init' } as SDKMessage);
    adapter.handleMessage({ type: 'status', status: 'running' } as unknown as SDKMessage);

    expect(signals.every((s) => s.kind === 'transport')).toBe(true);
  });

  it('finish emits agent_end once without semantic progress', () => {
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
    adapter.handleMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'first\n' }] },
    } as SDKMessage);
    expect(signals.find((s) => s.kind === 'progress')?.isFirstForTurn).toBe(true);

    emitter.beginTurn();
    signals.length = 0;
    adapter.handleMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'next\n' } },
    } as SDKMessage);
    expect(signals.find((s) => s.kind === 'progress')?.isFirstForTurn).toBe(true);
  });
});
