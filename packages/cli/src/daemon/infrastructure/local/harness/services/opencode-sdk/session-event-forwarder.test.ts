import type { Writable } from 'node:stream';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  startSessionEventForwarder,
  type SessionEventForwarderOptions,
} from './session-event-forwarder.js';
import type { HarnessActivityEvent } from '../../../../../services/agent-process-service/index.js';

function makeWritable() {
  return {
    write: vi.fn(() => true),
    lines: [] as string[],
  };
}

function createMockClient(eventStream: AsyncIterable<unknown>) {
  return {
    event: {
      subscribe: vi.fn(() => eventStream),
    },
  };
}

function textDelta(delta: string, sessionID = 'sess-1') {
  return {
    type: 'session.text.delta',
    data: { sessionID, assistantMessageID: 'm1', ordinal: 0, delta },
  };
}

function reasoningDelta(delta: string, sessionID = 'sess-1') {
  return {
    type: 'session.reasoning.delta',
    data: { sessionID, assistantMessageID: 'm1', ordinal: 0, delta },
  };
}

function toolStarted(id: string, name: string, sessionID = 'sess-1') {
  return {
    type: 'session.tool.input.started',
    data: { sessionID, assistantMessageID: 'm1', id, name },
  };
}

function toolCalled(id: string, input: unknown, sessionID = 'sess-1') {
  return {
    type: 'session.tool.called',
    data: { sessionID, assistantMessageID: 'm1', id, input, executed: true },
  };
}

function toolSuccess(id: string, sessionID = 'sess-1') {
  return {
    type: 'session.tool.success',
    data: { sessionID, assistantMessageID: 'm1', id, content: [], executed: true },
  };
}

function toolFailed(id: string, sessionID = 'sess-1') {
  return {
    type: 'session.tool.failed',
    data: {
      sessionID,
      assistantMessageID: 'm1',
      id,
      error: { type: 'ToolError', message: 'boom' },
      executed: true,
    },
  };
}

function idleEvent(sessionID = 'sess-1') {
  return { type: 'session.idle', data: { sessionID } };
}

function statusEvent(type: string, sessionID = 'sess-1') {
  return { type: 'session.status', data: { sessionID, status: { type } } };
}

function executionFailed(error: { type: string; message: string }, sessionID = 'sess-1') {
  return { type: 'session.execution.failed', data: { sessionID, error } };
}

function executionSucceeded(sessionID = 'sess-1') {
  return { type: 'session.execution.succeeded', data: { sessionID } };
}

describe('SessionEventForwarder', () => {
  let target: ReturnType<typeof makeWritable>;
  let errorTarget: ReturnType<typeof makeWritable>;
  let baseOptions: SessionEventForwarderOptions;

  beforeEach(() => {
    target = makeWritable();
    errorTarget = makeWritable();
    baseOptions = {
      sessionId: 'sess-1',
      role: 'builder',
      target: target as unknown as Writable,
      errorTarget: errorTarget as unknown as Writable,
      now: () => 'fake-ts',
    };
  });

  async function* streamOf(events: unknown[], delayMs = 10): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, delayMs));
    for (const e of events) yield e;
  }

  it('text deltas forwarded', async () => {
    vi.useFakeTimers();
    const onActivity = vi.fn();
    const fakeClient = createMockClient(streamOf([textDelta('hello')]));
    const handle = startSessionEventForwarder(fakeClient as never, { ...baseOptions, onActivity });
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder text] hello\n');
    expect(onActivity).toHaveBeenCalled();
  }, 10000);

  it('reasoning deltas forwarded as thinking]', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([reasoningDelta('step 1')]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder thinking] step 1\n');
  }, 10000);

  it('tool call logs running then completed with duration', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([toolStarted('c1', 'bash'), toolCalled('c1', { command: 'ls' }), toolSuccess('c1')])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder tool: bash] running: ls\n');
    expect(target.write).toHaveBeenCalledWith(
      expect.stringContaining('[fake-ts] role:builder tool: bash] completed')
    );
  }, 10000);

  it('tool failure logs error state', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([toolStarted('c1', 'bash'), toolCalled('c1', { command: 'ls' }), toolFailed('c1')])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith(expect.stringContaining('tool: bash] error'));
  }, 10000);

  it('deduplicates repeated tool.called for the same call id', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([
        toolStarted('c1', 'bash'),
        toolCalled('c1', { command: 'ls' }),
        toolCalled('c1', { command: 'ls' }),
        toolCalled('c1', { command: 'ls' }),
      ])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const toolLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('tool: bash'));
    expect(toolLines).toHaveLength(1);
  }, 10000);

  it('session.idle -> agent_end', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([idleEvent()]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder agent_end]\n');
  }, 10000);

  it('session.status idle without session.idle -> agent_end fired once', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([statusEvent('idle')]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder status] idle\n');
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder agent_end]\n');
  }, 10000);

  it('session.compaction.ended forwarded as compacted', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([{ type: 'session.compaction.ended', data: { sessionID: 'sess-1' } }])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder compacted]\n');
  }, 10000);

  it('invokes onLogLine for forwarded log lines', async () => {
    vi.useFakeTimers();
    const onLogLine = vi.fn();
    const fakeClient = createMockClient(
      streamOf([executionFailed({ type: 'UnknownError', message: 'oops' })])
    );
    const handle = startSessionEventForwarder(fakeClient as never, { ...baseOptions, onLogLine });
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onLogLine).toHaveBeenCalledWith(
      '[fake-ts] role:builder session] Started] role: builder'
    );
    expect(onLogLine).toHaveBeenCalledWith('[fake-ts] role:builder error] UnknownError: oops');
  }, 10000);

  it('session.execution.succeeded -> agent_end completed', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([executionSucceeded()]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder agent_end]\n');
  }, 10000);

  it('session.execution.failed -> errorTarget and agent_end failed', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([executionFailed({ type: 'UnknownError', message: 'oops' })])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(errorTarget.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder error] UnknownError: oops\n'
    );
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder session] Started] role: builder\n'
    );
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: execution_failed\n'
    );
  }, 10000);

  it('session error usage-limit -> agent_end fired + logged', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([
        executionFailed({
          type: 'GoUsageLimitError',
          message: 'Monthly usage limit reached. Resets in 6 days.',
        }),
      ])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: provider_rate_limit\n'
    );
  }, 10000);

  it('session error model load failure -> agent_end fired + logged', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([
        executionFailed({
          type: 'ModelLoadError',
          message:
            'Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
        }),
      ])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(errorTarget.write).toHaveBeenCalledWith(expect.stringContaining('Failed to load model'));
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: provider_rate_limit\n'
    );
  }, 10000);

  it('stream throws weekly rate limit -> agent_end fired from catch block', async () => {
    async function* weeklyRateLimitStreamThrow(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield textDelta('hello');
      throw {
        name: 'APIError',
        data: {
          message:
            "Sorry, you've exceeded your weekly rate limit. Please review our Terms of Service.",
        },
        responseHeaders: { 'x-ratelimit-exceeded': 'true' },
      };
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(weeklyRateLimitStreamThrow());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: provider_rate_limit\n'
    );
  }, 10000);

  it('session.status retry after structured rate limit error -> agent_end fired', async () => {
    async function* retryAfterRateLimitStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield executionFailed({ type: 'AI_APICallError', message: 'Rate limit exceeded.' });
      yield statusEvent('retry');
      await new Promise(() => {});
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(retryAfterRateLimitStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: provider_rate_limit\n'
    );
  }, 10000);

  it('session.status retry without structured error waits for timeout before agent_end', async () => {
    async function* retryOnlyStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield statusEvent('retry');
      await new Promise(() => {});
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(retryOnlyStream());
    const handle = startSessionEventForwarder(fakeClient as never, {
      ...baseOptions,
      sessionRetryIdleTimeoutMs: 1_000,
    });
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder status] retry_timeout\n');
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: retry_timeout\n'
    );
  }, 10000);

  it('abortTerminalProviderError from stderr path -> agent_end fired once', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      (async function* () {
        await new Promise(() => {});
      })()
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    handle.abortTerminalProviderError();
    handle.abortTerminalProviderError();
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
  }, 10000);

  it('session.idle after provider rate limit abort does not double agent_end', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([
        executionFailed({ type: 'AI_APICallError', message: 'Rate limit exceeded.' }),
        idleEvent(),
      ])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder agent_end] reason: provider_rate_limit\n'
    );
  }, 10000);

  it('filter: events for OTHER sessions ignored', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([textDelta('hello', 'other-sess')]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).not.toHaveBeenCalled();
  }, 10000);

  it('filter: session-scoped events without sessionID are dropped', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(
      streamOf([{ type: 'session.text.delta', data: { assistantMessageID: 'm1', delta: 'x' } }])
    );
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).not.toHaveBeenCalled();
  }, 10000);

  it('stop() cancels iteration', async () => {
    vi.useFakeTimers();
    let yielded = false;
    async function* streamingGen(): AsyncGenerator<unknown> {
      yield textDelta('first');
      yielded = true;
      await new Promise(() => {});
    }

    const fakeClient = createMockClient(streamingGen());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    handle.stop();
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(yielded).toBe(true);
  }, 10000);

  it('stop() is idempotent', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([textDelta('hello')]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    handle.stop();
    handle.stop();
    vi.useRealTimers();
    await expect(handle.done).resolves.toBeUndefined();
  }, 10000);

  it('iteration error -> errorTarget logged, done resolves', async () => {
    async function* errorGen(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield textDelta('first');
      throw new Error('stream exploded');
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(errorGen());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(errorTarget.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder error] stream exploded\n'
    );
  }, 10000);

  it('session start log emitted before first event', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(streamOf([textDelta('hello')]));
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const calls = (target.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('[fake-ts] role:builder session] Started] role: builder\n');
  }, 10000);

  it('unknown session.status logs unknown_session_status and does not emit agent_end', async () => {
    vi.useFakeTimers();
    const ps = createPushStream();
    const fakeClient = createMockClient(ps.stream);
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);

    ps.push(statusEvent('compacting'));
    await vi.advanceTimersByTimeAsync(10);
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder status] unknown_session_status:compacting\n'
    );
    expect(onEnd).not.toHaveBeenCalled();

    ps.push(statusEvent('compacting'));
    await vi.advanceTimersByTimeAsync(10);
    const statusLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('status'));
    expect(statusLines.filter((l) => l.includes('compacting'))).toHaveLength(1);

    ps.end();
    await handle.done;
    vi.useRealTimers();
  }, 10000);

  it('session.status busy logs busy, fires onActivity, and does not emit agent_end', async () => {
    vi.useFakeTimers();
    const ps = createPushStream();
    const fakeClient = createMockClient(ps.stream);
    const onActivity = vi.fn();
    const handle = startSessionEventForwarder(fakeClient as never, { ...baseOptions, onActivity });
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);

    ps.push(statusEvent('busy'));
    await vi.advanceTimersByTimeAsync(10);
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder status] busy\n');
    expect(onActivity).toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();

    ps.end();
    await handle.done;
    vi.useRealTimers();
  }, 10000);

  // ── Multi-turn (armTurnEnd) ────────────────────────────────────────────

  function createPushStream() {
    let pending: (() => void) | null = null;
    const events: unknown[] = [];
    let streamEnded = false;

    return {
      push: (event: unknown) => {
        events.push(event);
        if (pending) {
          pending();
          pending = null;
        }
      },
      end: () => {
        streamEnded = true;
        if (pending) {
          pending();
          pending = null;
        }
      },

      stream: (async function* () {
        while (true) {
          while (events.length > 0) {
            yield events.shift()!;
          }
          if (streamEnded) return;
          await new Promise<void>((resolve) => {
            pending = resolve;
          });
        }
      })(),
    };
  }

  it('two turns without arm: first idle emits agent_end, second idle does not (latch)', async () => {
    vi.useFakeTimers();
    const ps = createPushStream();
    const fakeClient = createMockClient(ps.stream);
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);

    ps.push(idleEvent());
    await vi.advanceTimersByTimeAsync(10);
    expect(onEnd).toHaveBeenCalledTimes(1);

    ps.push(statusEvent('busy'));
    await vi.advanceTimersByTimeAsync(10);
    ps.push(idleEvent());
    await vi.advanceTimersByTimeAsync(10);

    expect(onEnd).toHaveBeenCalledTimes(1);
    ps.end();
    await handle.done;
    vi.useRealTimers();
  }, 10000);

  it('two turns with arm: first idle → end; armTurnEnd → second idle → second end', async () => {
    vi.useFakeTimers();
    const ps = createPushStream();
    const fakeClient = createMockClient(ps.stream);
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);

    ps.push(statusEvent('busy'));
    await vi.advanceTimersByTimeAsync(10);
    ps.push(idleEvent());
    await vi.advanceTimersByTimeAsync(10);
    expect(onEnd).toHaveBeenCalledTimes(1);

    handle.armTurnEnd();

    ps.push(statusEvent('busy'));
    await vi.advanceTimersByTimeAsync(10);
    ps.push(idleEvent());
    await vi.advanceTimersByTimeAsync(10);

    expect(onEnd).toHaveBeenCalledTimes(2);
    ps.end();
    await handle.done;
    vi.useRealTimers();
  }, 10000);

  it('armTurnEnd after terminal abort is blocked', async () => {
    vi.useFakeTimers();
    const ps = createPushStream();
    const fakeClient = createMockClient(ps.stream);
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    const onEnd = vi.fn();
    handle.onAgentEnd(onEnd);

    ps.push(executionFailed({ type: 'GoUsageLimitError', message: 'rate limited' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(onEnd).toHaveBeenCalledTimes(1);

    handle.armTurnEnd();
    expect(target.write).toHaveBeenCalledWith(expect.stringContaining('turn_arm_blocked_terminal'));

    ps.push(idleEvent());
    await vi.advanceTimersByTimeAsync(10);
    expect(onEnd).toHaveBeenCalledTimes(1);

    ps.end();
    await handle.done;
    vi.useRealTimers();
  }, 10000);

  describe('typed activity signals', () => {
    async function runStream(
      stream: AsyncIterable<unknown>,
      extra?: Partial<SessionEventForwarderOptions>
    ) {
      const events: HarnessActivityEvent[] = [];
      vi.useFakeTimers();
      const fakeClient = createMockClient(stream);
      const handle = startSessionEventForwarder(fakeClient as never, {
        ...baseOptions,
        ...extra,
        onActivity: (event) => events.push(event),
      });
      await vi.advanceTimersByTimeAsync(50);
      await handle.done;
      vi.useRealTimers();
      return events;
    }

    it('text delta yields transport then progress with text source', async () => {
      const events = await runStream(streamOf([textDelta('hello')]));
      expect(events.map((e) => e.kind)).toEqual(['transport', 'progress']);
      expect(events[0]?.source).toBe('opencode.event.session.text.delta');
      expect(events[1]?.source).toBe('opencode.session.text.delta');
    });

    it('reasoning delta yields progress with reasoning source', async () => {
      const events = await runStream(streamOf([reasoningDelta('step')]));
      expect(events.some((e) => e.source === 'opencode.session.reasoning.delta')).toBe(true);
    });

    it('session.status busy yields progress; retry yields waiting', async () => {
      const events = await runStream(streamOf([statusEvent('busy'), statusEvent('retry')]));
      expect(
        events.some((e) => e.source === 'opencode.session.status.busy' && e.kind === 'progress')
      ).toBe(true);
      expect(
        events.some((e) => e.source === 'opencode.session.status.retry' && e.kind === 'waiting')
      ).toBe(true);
    });

    it('session error yields failure; idle yields only transport', async () => {
      const errorEvents = await runStream(
        streamOf([executionFailed({ type: 'UnknownError', message: 'oops' })])
      );
      expect(
        errorEvents.some((e) => e.source === 'opencode.session.error' && e.kind === 'failure')
      ).toBe(true);

      const idleEvents = await runStream(streamOf([idleEvent()]));
      expect(idleEvents.every((e) => e.kind === 'transport')).toBe(true);
    });

    it('other-session events produce no activity', async () => {
      const otherEvents = await runStream(streamOf([textDelta('x', 'other-sess')]));
      expect(otherEvents).toHaveLength(0);
    });
  });
});
