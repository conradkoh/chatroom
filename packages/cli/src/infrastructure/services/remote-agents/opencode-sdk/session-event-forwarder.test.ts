import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';

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
        part: { type: 'text', sessionID: 'sess-1', delta: 'hello' },
      },
    };
  }

  async function* toolCallStream(): AsyncGenerator<unknown> {
    await new Promise((r) => setTimeout(r, 10));
    yield {
      type: 'message.part.updated',
      properties: {
        part: { type: 'tool', tool: 'bash', sessionID: 'sess-1' },
        state: 'completed',
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
        part: { type: 'text', sessionID: 'other-sess', delta: 'hello' },
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

  it('tool calls forwarded', async () => {
    vi.useFakeTimers();
    const fakeClient = createMockClient(toolCallStream());
    const handle = startSessionEventForwarder(fakeClient as never, baseOptions);
    await vi.advanceTimersByTimeAsync(50);
    await handle.done;
    vi.useRealTimers();
    expect(target.write).toHaveBeenCalledWith('[fake-ts] role:builder tool: bash #1] completed\n');
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
    expect(target.write).not.toHaveBeenCalled();
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

  it('filter: events with no sessionID dropped', async () => {
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
        properties: { part: { type: 'text', sessionID: 'sess-1', delta: 'first' } },
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
    expect(handle.done).resolves.toBeUndefined();
  }, 10000);

  it('iteration error -> errorTarget logged, done resolves', async () => {
    async function* errorGen(): AsyncGenerator<unknown> {
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: 'message.part.updated',
        properties: { part: { type: 'text', sessionID: 'sess-1', delta: 'first' } },
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
});
