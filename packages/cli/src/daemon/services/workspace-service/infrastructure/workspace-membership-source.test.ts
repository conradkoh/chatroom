import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceMembershipSource,
  type ConvexWsClientLike,
} from './workspace-membership-source.js';
import { api } from '../../../../api.js';

type Callback = (workingDirs: unknown) => void;

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

/** Subscribes a source to a fake client, pushes one payload, and returns the callback spy. */
function deliverToCallback(payload: unknown) {
  const client = fakeWsClient();
  const source = createWorkspaceMembershipSource({
    wsClient: client.wsClient,
    sessionId: SESSION_ID,
    machineId: 'machine-1',
  });
  const onWorkingDirs = vi.fn();
  source.subscribe(onWorkingDirs);
  client.push(payload);
  return onWorkingDirs;
}

/** Returns the working dirs delivered for one payload, or undefined when the callback was not called. */
function deliver(payload: unknown): readonly string[] | undefined {
  const onWorkingDirs = deliverToCallback(payload);
  return onWorkingDirs.mock.calls.length === 0 ? undefined : onWorkingDirs.mock.calls[0][0];
}

describe('createWorkspaceMembershipSource parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards a valid string array unchanged', () => {
    expect(deliver(['/repo/a', '/repo/b/'])).toEqual(['/repo/a', '/repo/b/']);
  });

  it('forwards an empty array, because empty is a valid membership', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(deliver([])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips a payload that is not an array, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(deliver({ workingDir: '/repo/a' })).toBeUndefined();
    expect(deliver(null)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('skips an array that contains a non-string, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const onWorkingDirs = deliverToCallback(['/repo/a', 42]);

    expect(onWorkingDirs).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('createWorkspaceMembershipSource subscription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to the registered working dirs query with the session and machine id', () => {
    const client = fakeWsClient();
    const source = createWorkspaceMembershipSource({
      wsClient: client.wsClient,
      sessionId: SESSION_ID,
      machineId: 'machine-1',
    });

    source.subscribe(vi.fn());

    // api.* builds a new reference on each access, so compare the Convex function name instead.
    expect(getFunctionName(client.onUpdate.mock.calls[0][0] as never)).toBe(
      getFunctionName(api.workspaces.listRegisteredWorkingDirsForMachine)
    );
    expect(client.onUpdate.mock.calls[0][1]).toEqual({
      sessionId: SESSION_ID,
      machineId: 'machine-1',
    });
  });

  it('stops callbacks and unsubscribes the client after unsubscribe', () => {
    const client = fakeWsClient();
    const source = createWorkspaceMembershipSource({
      wsClient: client.wsClient,
      sessionId: SESSION_ID,
      machineId: 'machine-1',
    });
    const onWorkingDirs = vi.fn();

    const unsubscribe = source.subscribe(onWorkingDirs);
    unsubscribe();
    client.push(['/repo/a']);

    expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    expect(onWorkingDirs).not.toHaveBeenCalled();
  });
});
