import { describe, expect, it, vi } from 'vitest';

import { operationalSignalCursorAt, runOperationalInbox } from './operational-inbox.js';

const CHATROOM_ID = 'room-1';

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
            chatroomId: CHATROOM_ID,
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
        chatroomId: CHATROOM_ID,
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
    expect(client.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'session-1',
        machineId: 'machine-1',
        chatroomId: CHATROOM_ID,
        afterKey: '0000000000000010:',
      }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ chatroomId: CHATROOM_ID });
    expect(client.query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      machineId: 'machine-1',
      chatroomId: CHATROOM_ID,
      afterSignalKey: '0000000000000010:',
      throughSignalKey: '0000000000000011:room-1:builder',
      limit: 500,
    });
  });

  it('passes the room id to both the reactive subscription and the imperative hydration query', async () => {
    let deliverPage: ((page: unknown) => void) | undefined;
    const client = {
      onUpdate: vi.fn((_query, _args, onPage) => {
        deliverPage = onPage;
        return vi.fn();
      }),
      query: vi
        .fn()
        .mockResolvedValue({ rows: [], removed: [], nextSignalKey: null, hasMore: false }),
    };
    const controller = new AbortController();
    const runPromise = runOperationalInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        chatroomId: CHATROOM_ID,
        serviceStartedAt: 10,
        signal: controller.signal,
      },
      async () => {
        controller.abort();
      }
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    deliverPage?.({
      items: [
        {
          chatroomId: CHATROOM_ID,
          role: 'builder',
          revisionKey: 'revision-1',
          signalKey: '0000000000000011:room-1:builder',
          projectedAt: 11,
        },
      ],
      highKey: '0000000000000011:room-1:builder',
    });
    await runPromise;

    expect(client.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ machineId: 'machine-1', chatroomId: CHATROOM_ID }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ machineId: 'machine-1', chatroomId: CHATROOM_ID })
    );
  });
});
