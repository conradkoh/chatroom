import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceActivitySource,
  type ConvexWsClientLike,
} from './workspace-activity-source.js';
import type { WorkspaceActivityRow } from '../domain/observation-tier.js';

type Callback = (rows: unknown) => void;

const SESSION_ID = 'session-1' as SessionId;

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

/** Subscribes a source to a fake client and returns the rows delivered for one payload. */
function deliver(payload: unknown): readonly WorkspaceActivityRow[] | undefined {
  const client = fakeWsClient();
  const source = createWorkspaceActivitySource({
    wsClient: client.wsClient,
    sessionId: SESSION_ID,
    machineId: 'machine-1',
  });
  const onRows = vi.fn();
  source.subscribe(onRows);
  client.push(payload);
  return onRows.mock.calls.length === 0 ? undefined : onRows.mock.calls[0][0];
}

describe('createWorkspaceActivitySource parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes valid rows, including a null lastObservedAt', () => {
    expect(
      deliver([
        { workingDir: '/a', lastObservedAt: 1_000 },
        { workingDir: '/b', lastObservedAt: null },
      ])
    ).toEqual([
      { workingDir: '/a', lastObservedAt: 1_000 },
      { workingDir: '/b', lastObservedAt: null },
    ]);
  });

  it('drops a row with an extra key and keeps the rest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const rows = deliver([
      { workingDir: '/a', lastObservedAt: 1, extra: true },
      { workingDir: '/b', lastObservedAt: 2 },
    ]);

    expect(rows).toEqual([{ workingDir: '/b', lastObservedAt: 2 }]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('drops a row whose lastObservedAt is neither a number nor null', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      deliver([
        { workingDir: '/a', lastObservedAt: '1000' },
        { workingDir: '/b', lastObservedAt: undefined },
      ])
    ).toEqual([]);
  });

  it('skips a payload that is not an array without calling onRows', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(deliver({ workingDir: '/a', lastObservedAt: 1 })).toBeUndefined();
    expect(deliver(null)).toBeUndefined();
  });
});

describe('createWorkspaceActivitySource subscription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes with the session and machine id', () => {
    const client = fakeWsClient();
    const source = createWorkspaceActivitySource({
      wsClient: client.wsClient,
      sessionId: SESSION_ID,
      machineId: 'machine-1',
    });

    source.subscribe(vi.fn());

    expect(client.onUpdate.mock.calls[0][1]).toEqual({
      sessionId: SESSION_ID,
      machineId: 'machine-1',
    });
  });

  it('stops callbacks and unsubscribes the client after unsubscribe', () => {
    const client = fakeWsClient();
    const source = createWorkspaceActivitySource({
      wsClient: client.wsClient,
      sessionId: SESSION_ID,
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
