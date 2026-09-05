import { describe, expect, it, vi } from 'vitest';

import { createTaskSignalIterator, runTaskInbox } from './task.js';

describe('runTaskInbox', () => {
  it('does not advance signal cursor when onUpdate throws', async () => {
    const subscriptionAfterKeys: string[] = [];
    const page = {
      items: [{ taskId: 'task-1' }],
      highKey: '0000000000000011:task-1',
    };
    const client = {
      onUpdate: vi.fn((_query, args, onPage) => {
        subscriptionAfterKeys.push(args.afterKey);
        queueMicrotask(() => onPage(page));
        return vi.fn();
      }),
    };
    const options = {
      client: client as never,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
      chatroomId: 'chatroom-1',
      initialAfterSignalKey: '0000000000000010:',
    };

    const first = createTaskSignalIterator(options);
    await first.next();
    // The consumer's failure happens before the generator resumes, so it must
    // not commit the page high key to the next subscription cursor.
    const retry = createTaskSignalIterator(options);
    await retry.next();

    expect(subscriptionAfterKeys).toEqual(['0000000000000010:', '0000000000000010:']);
  });

  it('subscribes at room scope and hydrates task records through the signal page', async () => {
    const query = vi.fn().mockResolvedValue({
      snapshots: [{ taskId: 'task-1' }],
      nextSignalKey: null,
      hasMore: false,
    });
    let deliverPage: ((page: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const client = {
      onUpdate: vi.fn(
        (_query: unknown, args: Record<string, unknown>, onPage: (page: unknown) => void) => {
          deliverPage = onPage;
          return unsubscribe;
        }
      ),
      query,
    };
    const controller = new AbortController();
    const updates: unknown[] = [];

    const runPromise = runTaskInbox(
      {
        client: client as never,
        sessionId: 'session-1' as never,
        machineId: 'machine-1',
        chatroomId: 'chatroom-1',
        serviceStartedAt: 10,
        signal: controller.signal,
      },
      async (update) => {
        updates.push(update);
        controller.abort();
      }
    );

    await vi.waitFor(() => expect(deliverPage).toBeDefined());
    deliverPage?.({
      items: [
        {
          chatroomId: 'chatroom-1',
          taskId: 'task-1',
          targetRole: 'planner',
          taskStatus: 'pending',
          signalKey: '0000000000000011:task-1',
          taskUpdatedAt: 11,
        },
      ],
      highKey: '0000000000000011:task-1',
    });

    await runPromise;

    // Exactly one room-scoped signal subscription for the one signal page —
    // no second subscription and no presence/config query. (Convex function
    // refs are unprintable Proxies, so identity is proven by the single
    // mock client entry point plus the exact arguments below.)
    expect(client.onUpdate).toHaveBeenCalledTimes(1);
    expect(client.onUpdate.mock.calls[0]![1]).toEqual({
      sessionId: 'session-1',
      machineId: 'machine-1',
      chatroomId: 'chatroom-1',
      afterKey: '0000000000000010:',
      limit: 100,
    });

    // Exactly one imperative range hydration for the one signal page.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      machineId: 'machine-1',
      chatroomId: 'chatroom-1',
      afterSignalKey: '0000000000000010:',
      throughSignalKey: '0000000000000011:task-1',
      limit: 500,
    });
    // One signal page → one range hydration → one handler update.
    expect(updates).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalled();
  });
});
