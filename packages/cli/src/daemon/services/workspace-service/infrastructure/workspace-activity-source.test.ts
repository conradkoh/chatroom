import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceActivitySource,
  parseWorkspaceActivityRows,
  type ConvexWsClientLike,
} from './workspace-activity-source.js';

type Callback = (rows: unknown) => void;

/** A fake client that records the subscription and lets the test push payloads. */
function fakeWsClient() {
  let callback: Callback | null = null;
  const unsubscribe = vi.fn();
  const onUpdate = vi.fn((_query: unknown, _args: unknown, cb: Callback): (() => void) => {
    callback = cb;
    return unsubscribe;
  });
  const wsClient = { onUpdate } as unknown as ConvexWsClientLike;
  return {
    wsClient,
    onUpdate,
    unsubscribe,
    push(payload: unknown) {
      if (callback === null) throw new Error('not subscribed');
      callback(payload);
    },
  };
}

describe('parseWorkspaceActivityRows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes valid rows, including a null lastObservedAt', () => {
    const rows = parseWorkspaceActivityRows([
      { workingDir: '/a', lastObservedAt: 1_000 },
      { workingDir: '/b', lastObservedAt: null },
    ]);

    expect(rows).toEqual([
      { workingDir: '/a', lastObservedAt: 1_000 },
      { workingDir: '/b', lastObservedAt: null },
    ]);
  });

  it('drops a row with an extra key and keeps the rest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const rows = parseWorkspaceActivityRows([
      { workingDir: '/a', lastObservedAt: 1, extra: true },
      { workingDir: '/b', lastObservedAt: 2 },
    ]);

    expect(rows).toEqual([{ workingDir: '/b', lastObservedAt: 2 }]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('drops a row whose lastObservedAt is not a number or null', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const rows = parseWorkspaceActivityRows([
      { workingDir: '/a', lastObservedAt: '1000' },
      { workingDir: '/b', lastObservedAt: undefined },
    ]);

    expect(rows).toEqual([]);
  });

  it('returns null for a payload that is not an array', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(parseWorkspaceActivityRows({ workingDir: '/a', lastObservedAt: 1 })).toBeNull();
    expect(parseWorkspaceActivityRows(null)).toBeNull();
  });
});

describe('createWorkspaceActivitySource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes with the session and machine id and delivers parsed rows', () => {
    const client = fakeWsClient();
    const source = createWorkspaceActivitySource({
      wsClient: client.wsClient,
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    const onRows = vi.fn();

    source.subscribe(onRows);
    client.push([{ workingDir: '/a', lastObservedAt: 5 }]);

    expect(client.onUpdate.mock.calls[0][1]).toEqual({
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    expect(onRows).toHaveBeenCalledWith([{ workingDir: '/a', lastObservedAt: 5 }]);
  });

  it('skips a non-array payload without calling onRows', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = fakeWsClient();
    const source = createWorkspaceActivitySource({
      wsClient: client.wsClient,
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    const onRows = vi.fn();

    source.subscribe(onRows);
    client.push(undefined);

    expect(onRows).not.toHaveBeenCalled();
  });

  it('stops callbacks and unsubscribes the client after unsubscribe', () => {
    const client = fakeWsClient();
    const source = createWorkspaceActivitySource({
      wsClient: client.wsClient,
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    const onRows = vi.fn();

    const unsubscribe = source.subscribe(onRows);
    unsubscribe();
    client.push([{ workingDir: '/a', lastObservedAt: 5 }]);

    expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    expect(onRows).not.toHaveBeenCalled();
  });
});
