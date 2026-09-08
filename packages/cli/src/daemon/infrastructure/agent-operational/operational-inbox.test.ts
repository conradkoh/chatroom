import { describe, expect, it, vi } from 'vitest';

import { operationalSignalCursorAt, runOperationalInbox } from './operational-inbox.js';

const CHATROOM_ID = 'room-1';

function makeObserver() {
  return {
    subscriptionStarted: vi.fn<(chatroomId: string) => void>(),
    subscriptionStopped: vi.fn<(chatroomId: string) => void>(),
    signalPageReceived:
      vi.fn<
        (chatroomId: string, signals: readonly { role: string; projectedAt: number }[]) => void
      >(),
    hydrationCompleted:
      vi.fn<(chatroomId: string, result: { rowCount: number; removedRowCount: number }) => void>(),
  };
}

function makeSignal(role: string, projectedAt: number, suffix: string): Record<string, unknown> {
  return {
    chatroomId: CHATROOM_ID,
    role,
    revisionKey: `revision-${suffix}`,
    signalKey: `00000000000000${suffix}:${CHATROOM_ID}:${role}`,
    projectedAt,
  };
}

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

  it('does not call page or hydration observer callbacks while idle', async () => {
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
    const observer = makeObserver();
    const runPromise = runOperationalInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        chatroomId: CHATROOM_ID,
        serviceStartedAt: 10,
        signal: controller.signal,
        observer,
      },
      async () => undefined
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    // An idle `null` result never resolves a page.
    deliverPage?.(null);
    controller.abort();
    await expect(runPromise).rejects.toThrow('Operational inbox stopped');

    expect(observer.signalPageReceived).not.toHaveBeenCalled();
    expect(observer.hydrationCompleted).not.toHaveBeenCalled();
    expect(observer.subscriptionStarted).toHaveBeenCalledTimes(1);
    expect(observer.subscriptionStarted).toHaveBeenCalledWith(CHATROOM_ID);
    expect(observer.subscriptionStopped).toHaveBeenCalledTimes(1);
    expect(observer.subscriptionStopped).toHaveBeenCalledWith(CHATROOM_ID);
  });

  it('notifies the observer across the page lifecycle and stops exactly once on cleanup', async () => {
    let deliverPage: ((page: unknown) => void) | undefined;
    const client = {
      onUpdate: vi.fn((_query, _args, onPage) => {
        deliverPage = onPage;
        return vi.fn();
      }),
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            chatroomId: CHATROOM_ID,
            role: 'builder',
            operationalState: 'running',
            isAlive: true,
            isRunning: true,
            daemonConnected: true,
            revisionKey: 'revision-1',
          },
        ],
        removed: [],
        nextSignalKey: null,
        hasMore: false,
      }),
    };
    const controller = new AbortController();
    const observer = makeObserver();
    const runPromise = runOperationalInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        chatroomId: CHATROOM_ID,
        serviceStartedAt: 10,
        signal: controller.signal,
        observer,
      },
      async () => {
        controller.abort();
      }
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    const items = [makeSignal('builder', 11, '11'), makeSignal('planner', 12, '12')];
    deliverPage?.({ items, highKey: '0000000000000012:room-1:planner' });
    await runPromise;

    expect(observer.subscriptionStarted).toHaveBeenCalledTimes(1);
    expect(observer.subscriptionStarted).toHaveBeenCalledWith(CHATROOM_ID);
    expect(observer.signalPageReceived).toHaveBeenCalledTimes(1);
    expect(observer.signalPageReceived).toHaveBeenCalledWith(
      CHATROOM_ID,
      expect.arrayContaining([
        expect.objectContaining({ role: 'builder', projectedAt: 11 }),
        expect.objectContaining({ role: 'planner', projectedAt: 12 }),
      ])
    );
    expect(observer.hydrationCompleted).toHaveBeenCalledTimes(1);
    expect(observer.hydrationCompleted).toHaveBeenCalledWith(CHATROOM_ID, {
      rowCount: 1,
      removedRowCount: 0,
    });
    expect(observer.subscriptionStopped).toHaveBeenCalledTimes(1);
    expect(observer.subscriptionStopped).toHaveBeenCalledWith(CHATROOM_ID);
  });

  it('reports the removed count only when a page hydrates removals', async () => {
    let deliverPage: ((page: unknown) => void) | undefined;
    const client = {
      onUpdate: vi.fn((_query, _args, onPage) => {
        deliverPage = onPage;
        return vi.fn();
      }),
      query: vi.fn().mockResolvedValue({
        rows: [],
        removed: [{ chatroomId: CHATROOM_ID, role: 'builder' }],
        nextSignalKey: null,
        hasMore: false,
      }),
    };
    const controller = new AbortController();
    const observer = makeObserver();
    const runPromise = runOperationalInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        chatroomId: CHATROOM_ID,
        serviceStartedAt: 10,
        signal: controller.signal,
        observer,
      },
      async () => {
        controller.abort();
      }
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    deliverPage?.({ items: [makeSignal('builder', 11, '11')], highKey: 'high-key' });
    await runPromise;

    expect(observer.hydrationCompleted).toHaveBeenCalledWith(CHATROOM_ID, {
      rowCount: 0,
      removedRowCount: 1,
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
