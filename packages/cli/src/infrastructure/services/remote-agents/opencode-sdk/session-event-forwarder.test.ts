import type { Writable } from 'node:stream';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  startSessionEventForwarder,
  type SessionEventForwarderOptions,
} from './session-event-forwarder.js';

function makeWritable() {
  return {
    write: vi.fn(() => true),
    lines: [] as string[],
  };
}

function createMockClient(eventStream: AsyncGenerator<unknown>) {
  return {
    event: {
      subscribe: vi.fn(() => ({
        stream: eventStream,
      })),
    },
  };
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

  async function* textDeltaStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        delta: 'hello',
        part: {
          id: 'p1',
          type: 'text',
          sessionID: 'sess-1',
          messageID: 'm1',
          text: '',
        },
      },
    };
  }

  async function* textSnapshotStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'p1',
          type: 'text',
          sessionID: 'sess-1',
          messageID: 'm1',
          text: 'full reply',
        },
      },
    };
  }

  async function* reasoningStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        delta: 'step 1',
        part: {
          id: 'p2',
          type: 'reasoning',
          sessionID: 'sess-1',
          messageID: 'm1',
          text: '',
          time: { start: 0 },
        },
      },
    };
  }

  async function* toolCallStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'p1',
          type: 'tool',
          tool: 'bash',
          sessionID: 'sess-1',
          messageID: 'm1',
          callID: 'c1',
          state: {
            status: 'completed',
            input: {},
            output: 'ok',
            title: 'x',
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      },
    };
  }

  async function* idleStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'session.idle',
      properties: { sessionID: 'sess-1' },
    };
  }

  async function* compactedStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'session.compacted',
      properties: { sessionID: 'sess-1' },
    };
  }

  async function* fileEditedStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'file.edited',
      properties: { file: 'src/foo.ts' },
    };
  }

  async function* errorStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'session.error',
      properties: {
        sessionID: 'sess-1',
        error: { name: 'UnknownError', data: { message: 'oops' } },
      },
    };
  }

  async function* otherSessionStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        delta: 'hello',
        part: {
          id: 'p1',
          type: 'text',
          sessionID: 'other-sess',
          messageID: 'm1',
          text: '',
        },
      },
    };
  }

  async function* textDeltaNoSessionIdStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        delta: 'no-session-id',
        part: { id: 'p1', type: 'text', messageID: 'm1', text: '' },
      },
    };
  }

  async function* noSessionIdStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'installation.updated',
      properties: { version: '1.0' },
    };
  }

  it('text deltas forwarded', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(textDeltaStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder text] hello\n');
  }, 10000);

  it('text snapshots (part.text) forwarded when no delta', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(textSnapshotStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder text] full reply\n');
  }, 10000);

  it('reasoning deltas forwarded as thinking]', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(reasoningStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder thinking] step 1\n');
  }, 10000);

  it('tool calls forwarded', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(toolCallStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder tool: bash] completed (0.0s)\n'
    );
  }, 10000);

  it('message.part.updated without sessionID still forwards (single-session forwarder)', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(textDeltaNoSessionIdStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder text] no-session-id\n');
  }, 10000);

  it('session.idle -> agent_end', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(idleStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder agent_end]\n');
  }, 10000);

  it('session.compacted forwarded', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(compactedStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder compacted]\n');
  }, 10000);

  it('session.error -> errorTarget', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(errorStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(errorTarget.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder error] UnknownError: oops\n'
    );
    // session start is logged to target before the error event
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder session] Started] role: builder\n'
    );
    expect(target.write).toHaveBeenCalledTimes(1);
  }, 10000);

  it('file.edited forwarded', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(fileEditedStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder file] src/foo.ts\n');
  }, 10000);

  it('filter: events for OTHER sessions ignored', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(otherSessionStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).not.toHaveBeenCalled();
  }, 10000);

  it('filter: non-session events without sessionID dropped', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(noSessionIdStream());
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
      yield {
        type: 'message.part.updated',
        properties: {
          delta: 'first',
          part: {
            id: 'p1',
            type: 'text',
            sessionID: 'sess-1',
            messageID: 'm1',
            text: '',
          },
        },
      };
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
    const fakeClient = createMockClient(textDeltaStream());
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
      yield {
        type: 'message.part.updated',
        properties: {
          delta: 'first',
          part: {
            id: 'p1',
            type: 'text',
            sessionID: 'sess-1',
            messageID: 'm1',
            text: '',
          },
        },
      };
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

  it('tool call with bash command input included in log line', async () => {
    async function* toolCallWithInputStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'c1',
            state: {
              status: 'running',
              input: { command: 'git status' },
              time: { start: 1000 },
            },
          },
        },
      };
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(toolCallWithInputStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder tool: bash] running: git status\n'
    );
  }, 10000);

  it('tool call with duration shown on completion', async () => {
    async function* toolCallWithDurationStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'c1',
            state: {
              status: 'completed',
              input: { command: 'git status' },
              output: 'ok',
              time: { start: 0, end: 1000 },
            },
          },
        },
      };
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(toolCallWithDurationStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder tool: bash] completed (1.0s): git status\n'
    );
  }, 10000);

  it('session start log emitted before first event', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(textDeltaStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const calls = (target.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('[fake-ts] role:builder session] Started] role: builder\n');
  }, 10000);

  it('file.edited with action kind included in log line', async () => {
    async function* fileEditedWithKindStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'file.edited',
        properties: { file: 'src/foo.ts', action: 'modified' },
      };
    }

    vi.useFakeTimers();
    const fakeClient = createMockClient(fileEditedWithKindStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith(
      '[fake-ts] role:builder file] src/foo.ts (modified)\n'
    );
  }, 10000);

  it('deduplicates repeated tool events with the same callID and status', async () => {
    vi.useFakeTimers();
    async function* duplicateRunningStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      for (let i = 0; i < 3; i++) {
        yield {
          type: 'message.part.updated',
          properties: {
            state: 'running',
            part: {
              id: 'p1',
              type: 'tool',
              tool: 'bash',
              sessionID: 'sess-1',
              messageID: 'm1',
              callID: 'call-dedup',
              state: { status: 'running', input: { command: 'ls' } },
            },
          },
        };
      }
    }
    const fakeClient = createMockClient(duplicateRunningStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const toolLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('tool: bash'));
    expect(toolLines).toHaveLength(1);
  }, 10000);

  it('logs both running and completed status transitions for the same callID', async () => {
    vi.useFakeTimers();
    async function* runningThenCompletedStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'message.part.updated',
        properties: {
          state: 'running',
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'call-transition',
            state: { status: 'running', input: { command: 'ls' } },
          },
        },
      };
      yield {
        type: 'message.part.updated',
        properties: {
          state: 'completed',
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'call-transition',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              time: { start: 0, end: 300 },
            },
          },
        },
      };
    }
    const fakeClient = createMockClient(runningThenCompletedStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const toolLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('tool: bash'));
    expect(toolLines).toHaveLength(2);
  }, 10000);

  it('cleans up terminal state so a new running event after completed is logged', async () => {
    vi.useFakeTimers();
    async function* completedThenRunningAgainStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'message.part.updated',
        properties: {
          state: 'completed',
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'call-cleanup',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              time: { start: 0, end: 300 },
            },
          },
        },
      };
      // Simulate new "running" after terminal state cleaned up map entry
      yield {
        type: 'message.part.updated',
        properties: {
          state: 'running',
          part: {
            id: 'p1',
            type: 'tool',
            tool: 'bash',
            sessionID: 'sess-1',
            messageID: 'm1',
            callID: 'call-cleanup',
            state: { status: 'running', input: { command: 'pwd' } },
          },
        },
      };
    }
    const fakeClient = createMockClient(completedThenRunningAgainStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const toolLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('tool: bash'));
    expect(toolLines).toHaveLength(2);
  }, 10000);

  it('logs events for different callIDs independently', async () => {
    vi.useFakeTimers();
    async function* parallelCallsStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      for (const callID of ['call-A', 'call-B']) {
        yield {
          type: 'message.part.updated',
          properties: {
            state: 'running',
            part: {
              id: 'p1',
              type: 'tool',
              tool: 'bash',
              sessionID: 'sess-1',
              messageID: 'm1',
              callID,
              state: { status: 'running', input: { command: 'ls' } },
            },
          },
        };
      }
    }
    const fakeClient = createMockClient(parallelCallsStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    const toolLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((l: string) => l.includes('tool: bash'));
    expect(toolLines).toHaveLength(2);
  }, 10000);

  it('filter: session.created with non-matching info.id is ignored', async () => {
    vi.useFakeTimers();
    async function* sessionCreatedOtherStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'session.created',
        properties: { info: { id: 'other-session-99', title: 'Other', version: '1' } },
      };
    }
    const fakeClient = createMockClient(sessionCreatedOtherStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    // The session.created for a different session must be dropped by the sessionID filter
    expect(target.write).not.toHaveBeenCalled();
  }, 10000);

  it('filter: session.updated with matching info.id is allowed through', async () => {
    vi.useFakeTimers();
    async function* sessionUpdatedOwnStream(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      // baseOptions.sessionId is 'sess-1'
      yield {
        type: 'session.updated',
        properties: { info: { id: 'sess-1', title: 'Updated title', version: '1' } },
      };
    }
    const fakeClient = createMockClient(sessionUpdatedOwnStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    // session.updated has no handler that writes to target, but it must not be silently
    // misrouted — the important assertion is that sessionStarted is set (write was called
    // for the 'Started' line) which only happens after the filter passes the event through.
    const allLines = (target.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string);
    expect(allLines.some((l) => l.includes('Started'))).toBe(true);
  }, 10000);
});
