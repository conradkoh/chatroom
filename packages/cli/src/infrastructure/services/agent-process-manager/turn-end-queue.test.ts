import { describe, expect, test, vi } from 'vitest';

import { TurnEndQueue } from './turn-end-queue.js';

describe('TurnEndQueue', () => {
  test('whenIdle waits for enqueued async work', async () => {
    const queue = new TurnEndQueue();
    const work = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(work);
    await queue.whenIdle();

    expect(work).toHaveBeenCalledOnce();
  });
});
