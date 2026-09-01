import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { PiSdkStreamAdapter } from './pi-sdk-stream-adapter.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivitySignal,
} from '../../../../agent-process-manager/harness-activity-emitter.js';

const LOG_PREFIX = '[pi-sdk:builder@test';

function createAdapter() {
  const onLogLine = vi.fn();
  const emitter = createHarnessActivityEmitter();
  const signals: HarnessActivitySignal[] = [];
  emitter.onActivity((signal) => signals.push(signal));
  return {
    adapter: new PiSdkStreamAdapter(LOG_PREFIX, onLogLine, emitter),
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

function textDeltaEvent(delta: string): AgentSessionEvent {
  return {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta },
  } as AgentSessionEvent;
}

function thinkingDeltaEvent(delta: string): AgentSessionEvent {
  return {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta },
  } as AgentSessionEvent;
}

function toolStartEvent(toolName: string, args?: Record<string, unknown>): AgentSessionEvent {
  return {
    type: 'tool_execution_start',
    toolName,
    args,
  } as AgentSessionEvent;
}

function toolEndEvent(toolName: string, result: unknown, isError?: boolean): AgentSessionEvent {
  return {
    type: 'tool_execution_end',
    toolName,
    result,
    ...(isError !== undefined ? { isError } : {}),
  } as AgentSessionEvent;
}

function agentEndEvent(): AgentSessionEvent {
  return { type: 'agent_end' } as AgentSessionEvent;
}

describe('PiSdkStreamAdapter typed activity', () => {
  it('emits transport and progress for message_update text_delta', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(textDeltaEvent('Hello\n'));

    expect(signalSources(signals)).toContain('pi-sdk.message_update');
    expect(signalSources(signals)).toContain('pi-sdk.message.text_delta');
    expect(signals.find((s) => s.source === 'pi-sdk.message.text_delta')?.kind).toBe('progress');
    expect(signals.find((s) => s.source === 'pi-sdk.message_update')?.kind).toBe('transport');
  });

  it('emits progress for thinking_delta message updates', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(thinkingDeltaEvent('planning step\n'));

    expect(signalSources(signals)).toContain('pi-sdk.message.thinking_delta');
    expect(signals.find((s) => s.source === 'pi-sdk.message.thinking_delta')?.kind).toBe(
      'progress'
    );
  });

  it('emits transport, progress, and waiting for tool_execution_start', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(toolStartEvent('read', { path: 'README.md' }));

    expect(signalKinds(signals)).toEqual(['transport', 'progress', 'waiting']);
    expect(signalSources(signals)).toContain('pi-sdk.tool_execution_start');
  });

  it('emits transport and progress without failure for successful tool_execution_end', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(toolEndEvent('read', 'file contents'));

    expect(signalKinds(signals)).toEqual(['transport', 'progress']);
    expect(signalSources(signals)).toContain('pi-sdk.tool_execution_end');
    expect(signalKinds(signals)).not.toContain('failure');
  });

  it('emits transport, progress, and failure for error tool_execution_end', () => {
    const { adapter, signals } = createAdapter();
    adapter.handleEvent(toolEndEvent('bash', 'command failed', true));

    expect(signalKinds(signals)).toEqual(['transport', 'progress', 'failure']);
    expect(signalSources(signals)).toContain('pi-sdk.tool_execution_end');
  });

  it('emits transport only for agent_end and invokes agent-end callback', () => {
    const { adapter, signals } = createAdapter();
    const onAgentEnd = vi.fn();
    adapter.onAgentEnd(onAgentEnd);
    adapter.handleEvent(agentEndEvent());

    expect(signalSources(signals)).toContain('pi-sdk.agent_end');
    expect(signals.every((s) => s.kind === 'transport')).toBe(true);
    expect(onAgentEnd).toHaveBeenCalledTimes(1);
  });

  it('beginTurn resets isFirstForTurn for the next progress signal', () => {
    const { adapter, emitter, signals } = createAdapter();
    adapter.handleEvent(textDeltaEvent('first\n'));
    const firstProgress = signals.find((s) => s.kind === 'progress');
    expect(firstProgress?.isFirstForTurn).toBe(true);

    adapter.handleEvent(thinkingDeltaEvent('more\n'));
    const secondProgress = signals.filter((s) => s.kind === 'progress')[1];
    expect(secondProgress?.isFirstForTurn).toBe(false);

    emitter.beginTurn();
    adapter.handleEvent(textDeltaEvent('new turn\n'));
    const afterBeginTurn = signals.filter((s) => s.kind === 'progress').at(-1);
    expect(afterBeginTurn?.isFirstForTurn).toBe(true);
  });

  it('preserves existing log formatting for tool_execution_start', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleEvent(toolStartEvent('bash', { command: 'git status' }));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} tool: bash] running: git status`);
  });

  it('preserves existing log formatting for text deltas', () => {
    const { adapter, onLogLine } = createAdapter();
    adapter.handleEvent(textDeltaEvent('Hello world\n'));

    expect(onLogLine).toHaveBeenCalledWith(`${LOG_PREFIX} text] Hello world`);
  });
});
