import { describe, expect, it, vi } from 'vitest';

import { operationalSignalCursorAt, runOperationalInbox } from './operational-inbox.js';

describe('operational inbox', () => {
  it('builds a cursor immediately before a timestamp', () => {
    expect(operationalSignalCursorAt(42)).toBe('0000000000000042:');
    expect(operationalSignalCursorAt(-1)).toBe('0000000000000000:');
  });

  it('waits while idle and advances after the handler succeeds', async () => {
    const subscriptionAfterKeys: string[] = [];
    const pages = [
      {
        items: [
          {
            chatroomId: 'room-1',
            role: 'builder',
            revisionKey: 'revision-1',
            signalKey: '0000000000000011:room-1:builder',
            projectedAt: 11,
          },
        ],
        highKey: '0000000000000011:room-1:builder',
      },
    ];
    let deliverPage: ((page: unknown) => void) | undefined;
    const controller = new AbortController();
    const client = {
      onUpdate: vi.fn((_query, args, onPage) => {
        subscriptionAfterKeys.push(args.afterKey);
        deliverPage = onPage;
        return vi.fn();
      }),
      query: vi
        .fn()
        .mockResolvedValue({ rows: [], removed: [], nextSignalKey: null, hasMore: false }),
    };
    const updates: unknown[] = [];
    const runPromise = runOperationalInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        serviceStartedAt: 10,
        signal: controller.signal,
      },
      async (update) => {
        updates.push(update);
        controller.abort();
      }
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    // An idle `null` result does not resolve the page or advance the cursor.
    deliverPage?.(null);
    deliverPage?.(pages[0]);
    await runPromise;

    expect(subscriptionAfterKeys).toEqual(['0000000000000010:']);
    expect(updates).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      machineId: 'machine-1',
      afterSignalKey: '0000000000000010:',
      throughSignalKey: '0000000000000011:room-1:builder',
      limit: 500,
    });
  });
});
