import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PollClock } from './layers.js';
import { PollClockLive } from './layers.js';
import { MessageBuffer } from './message-buffer.js';
import { makePollLoop } from './poll-loop.js';
import type { IncrementalFeedDef, PollPage, PollRequest } from './types.js';

type TestItem = { key: string; value: string };

function makeDef(
  pollFn: (req: PollRequest<{ machineId: string }>) => Promise<PollPage<TestItem>>
): IncrementalFeedDef<TestItem, { machineId: string }> {
  return {
    name: 'test-feed',
    poll: pollFn,
    itemKey: (item) => item.key,
  };
}

async function runPollLoopForMs(
  loop: Effect.Effect<never, never, PollClock>,
  ms: number
): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(loop);
      yield* Effect.sleep(`${ms} millis`);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(PollClockLive))
  );
}

describe('makePollLoop', () => {
  it('advances cursor and enqueues items from poll pages', async () => {
    const calls: (string | null)[] = [];
    const pages: PollPage<TestItem>[] = [
      {
        items: [{ key: '001', value: 'a' }],
        highKey: '001',
        hasMore: false,
      },
      {
        items: [{ key: '002', value: 'b' }],
        highKey: '002',
        hasMore: false,
      },
    ];

    const def = makeDef(async (req) => {
      calls.push(req.afterKey);
      const page = pages.shift() ?? { items: [], highKey: null, hasMore: false };
      return page;
    });

    const buffer = new MessageBuffer<TestItem>(
      { maxSize: 10, deliveryMode: 'fifo' },
      (item: TestItem) => item.key
    );

    await runPollLoopForMs(
      makePollLoop(def, { machineId: 'm1' }, buffer, {
        intervalMs: 5,
        limit: 50,
        backoff: { initialMs: 1, maxMs: 10 },
      }),
      40
    );

    expect(calls[0]).toBeNull();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[1]).toBe('001');
    expect(buffer.size()).toBeGreaterThanOrEqual(1);
  });

  it('drains hasMore pages before sleeping', async () => {
    const calls: string[] = [];

    const def = makeDef(async (req) => {
      calls.push(req.afterKey ?? 'null');
      if (calls.length === 1) {
        return {
          items: [{ key: '001', value: 'a' }],
          highKey: '001',
          hasMore: true,
        };
      }
      if (calls.length === 2) {
        return {
          items: [{ key: '002', value: 'b' }],
          highKey: '002',
          hasMore: false,
        };
      }
      return { items: [], highKey: null, hasMore: false };
    });

    const buffer = new MessageBuffer<TestItem>(
      { maxSize: 10, deliveryMode: 'fifo' },
      (item: TestItem) => item.key
    );

    await runPollLoopForMs(
      makePollLoop(def, { machineId: 'm1' }, buffer, {
        intervalMs: 100,
        limit: 50,
        backoff: { initialMs: 1, maxMs: 10 },
      }),
      30
    );

    expect(calls).toEqual(['null', '001']);
    expect(buffer.size()).toBe(2);
  });

  it('backs off on poll errors without advancing cursor', async () => {
    let attempts = 0;

    const def = makeDef(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('network');
      }
      return {
        items: [{ key: '001', value: 'ok' }],
        highKey: '001',
        hasMore: false,
      };
    });

    const buffer = new MessageBuffer<TestItem>(
      { maxSize: 10, deliveryMode: 'fifo' },
      (item: TestItem) => item.key
    );

    await runPollLoopForMs(
      makePollLoop(def, { machineId: 'm1' }, buffer, {
        intervalMs: 1,
        limit: 50,
        backoff: { initialMs: 1, maxMs: 20 },
      }),
      80
    );

    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(buffer.size()).toBeGreaterThanOrEqual(1);
  });
});
