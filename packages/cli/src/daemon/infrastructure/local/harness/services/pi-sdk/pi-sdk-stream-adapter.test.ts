import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { PiSdkStreamAdapter } from './pi-sdk-stream-adapter.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivitySignal,
} from '../../../../../services/agent-process-service/index.js';

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

function agentEndEvent(willRetry = false): AgentSessionEvent {
  return { type: 'agent_end', willRetry } as AgentSessionEvent;
}

function assistantMessageEndEvent(stopReason: string, errorMessage?: string): AgentSessionEvent {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [],
      stopReason,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    },
  } as unknown as AgentSessionEvent;
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

describe('PiSdkStreamAdapter provider errors', () => {
  it('settles the turn as failed with the error message when an assistant error precedes agent_end', () => {
    const { adapter } = createAdapter();
    const onTurnResult = vi.fn();
    adapter.onTurnResult(onTurnResult);

    adapter.handleEvent(assistantMessageEndEvent('error', 'provider 400: bad model'));
    adapter.handleEvent(agentEndEvent());

    expect(adapter.turnCompletion.value).toMatchObject({
      status: 'failed',
      source: 'pi-sdk.agent_end',
      error: 'provider 400: bad model',
    });
    expect(onTurnResult).toHaveBeenCalledTimes(1);
    expect(onTurnResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('settles as completed for a successful assistant message followed by agent_end', () => {
    const { adapter } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('stop'));
    adapter.handleEvent(agentEndEvent());

    expect(adapter.turnCompletion.value).toMatchObject({
      status: 'completed',
      source: 'pi-sdk.agent_end',
    });
  });

  it('logs the provider error message as a run-error line', () => {
    const { adapter, onLogLine, signals } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('error', 'provider 400: bad model'));

    expect(onLogLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} run-error] assistant error: provider 400: bad model`
    );
    expect(signalKinds(signals)).toContain('failure');
  });

  it('uses a fallback message when the error carries no errorMessage', () => {
    const { adapter } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('error'));
    adapter.handleEvent(agentEndEvent());

    expect(adapter.turnCompletion.value).toMatchObject({
      status: 'failed',
      error: 'unknown provider error',
    });
  });

  it('defers the terminal decision while the SDK auto-retries, then completes when the retry succeeds', () => {
    const { adapter } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('error', 'overloaded'));
    adapter.handleEvent(agentEndEvent(true));
    expect(adapter.turnCompletion.isComplete).toBe(false);

    adapter.handleEvent(assistantMessageEndEvent('stop'));
    adapter.handleEvent(agentEndEvent(false));

    expect(adapter.turnCompletion.value).toMatchObject({ status: 'completed' });
  });

  it('settles as failed when the prompt resolves after an assistant error without agent_end', () => {
    const { adapter } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('error', 'provider 400: bad model'));
    adapter.settleResolvedPrompt();

    expect(adapter.turnCompletion.value).toMatchObject({
      status: 'failed',
      source: 'pi-sdk.prompt.resolved',
      error: 'provider 400: bad model',
    });
  });

  it('keeps a failed turn when the prompt resolves afterwards', () => {
    const { adapter } = createAdapter();
    adapter.handleEvent(assistantMessageEndEvent('error', 'provider 400: bad model'));
    adapter.handleEvent(agentEndEvent());
    adapter.settleResolvedPrompt();

    expect(adapter.turnCompletion.value).toMatchObject({ status: 'failed' });
  });
});
