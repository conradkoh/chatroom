import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startGitRequestSubscriber } from './git-request.js';
import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';

const SESSION_ID = 'session-git-request' as SessionId;
const MACHINE_ID = 'machine-git-request';
const MEMBERSHIP = getFunctionName(api.workspaces.listRegisteredWorkingDirsForMachine);
const PENDING = getFunctionName(api.workspaces.getPendingRequestsForWorkspace);
const OBSERVATION_LIST = getFunctionName(api.workspaces.listWorkspacesForMachine);
const STARTUP_DRAIN = 'startup-drain';

type Subscription = {
  name: string;
  args: Record<string, unknown>;
  callback: (result: unknown) => void;
  active: boolean;
  unsubscribe: ReturnType<typeof vi.fn>;
};

/** Fake Convex client. Each `onUpdate` is recorded by query name, and unsubscribing marks it inactive. */
function fakeClient() {
  const subscriptions: Subscription[] = [];
  const wsClient = {
    onUpdate: vi.fn(
      (query: unknown, args: Record<string, unknown>, callback: (result: unknown) => void) => {
        const sub: Subscription = {
          name: getFunctionName(query as Parameters<typeof getFunctionName>[0]),
          args,
          callback,
          active: true,
          unsubscribe: vi.fn(() => {
            sub.active = false;
          }),
        };
        subscriptions.push(sub);
        return sub.unsubscribe as unknown as () => void;
      }
    ),
    query: vi.fn().mockResolvedValue([]),
    mutation: vi.fn().mockResolvedValue(null),
  } as unknown as ConvexClient;

  const active = (name: string) => subscriptions.filter((sub) => sub.name === name && sub.active);
  return {
    wsClient,
    subscriptions,
    /** Delivers a registered-directory snapshot to the membership subscription. */
    snapshot(workingDirs: string[]) {
      for (const sub of active(MEMBERSHIP)) sub.callback(workingDirs);
    },
    /** Delivers pending requests to the active watch for `workingDir`. */
    pending(workingDir: string, requests: unknown[]) {
      for (const sub of active(PENDING)) {
        if (sub.args.workingDir === workingDir) sub.callback(requests);
      }
    },
    /** Every watch ever created for `workingDir`. */
    watchesFor(workingDir: string) {
      return subscriptions.filter(
        (sub) => sub.name === PENDING && sub.args.workingDir === workingDir
      );
    },
    activeWatchCount() {
      return active(PENDING).length;
    },
  };
}

function startWith(client: ReturnType<typeof fakeClient>) {
  const events: InboundEvent[] = [];
  const handle = startGitRequestSubscriber(
    { wsClient: client.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
    (event) => events.push(event)
  );
  return { handle, events };
}

const gitRequests = (events: InboundEvent[], requestId?: string) =>
  events.filter(
    (event) =>
      event.type === 'git.request' && (requestId === undefined || event.requestId === requestId)
  );

describe('git-request subscriber follows registered workspaces', () => {
  it('a membership snapshot creates one watcher per registered directory', async () => {
    const client = fakeClient();
    const { handle } = startWith(client);

    client.snapshot(['/a', '/b']);

    expect(client.watchesFor('/a')).toHaveLength(1);
    expect(client.watchesFor('/b')).toHaveLength(1);
    expect(client.activeWatchCount()).toBe(2);
    await handle.stop();
  });

  it('removing a directory unsubscribes its watcher', async () => {
    const client = fakeClient();
    const { handle } = startWith(client);
    client.snapshot(['/a', '/b']);

    client.snapshot(['/b']);

    expect(client.watchesFor('/a')[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.watchesFor('/b')[0].unsubscribe).not.toHaveBeenCalled();
    expect(client.activeWatchCount()).toBe(1);
    await handle.stop();
  });

  it('an added directory gets a watcher without restarting the subscriber', async () => {
    const client = fakeClient();
    const { handle } = startWith(client);
    client.snapshot(['/a']);
    const membershipSubscriptions = client.subscriptions.filter((sub) => sub.name === MEMBERSHIP);

    client.snapshot(['/a', '/c']);

    expect(client.watchesFor('/c')).toHaveLength(1);
    expect(client.watchesFor('/a')).toHaveLength(1);
    expect(client.subscriptions.filter((sub) => sub.name === MEMBERSHIP)).toEqual(
      membershipSubscriptions
    );
    await handle.stop();
  });

  it('a repeated request id emits git.request once', async () => {
    const client = fakeClient();
    const { handle, events } = startWith(client);
    client.snapshot(['/a']);

    client.pending('/a', [{ _id: 'req-1' }]);
    client.pending('/a', [{ _id: 'req-1' }]);

    expect(gitRequests(events, 'req-1')).toHaveLength(1);
    await handle.stop();
  });

  it('stop unsubscribes the membership subscription and every watcher', async () => {
    const client = fakeClient();
    const { handle } = startWith(client);
    client.snapshot(['/a', '/b']);

    await handle.stop();

    expect(client.subscriptions.filter((sub) => sub.active)).toEqual([]);
    expect(
      client.subscriptions.filter((sub) => sub.name === MEMBERSHIP)[0].unsubscribe
    ).toHaveBeenCalledTimes(1);
  });

  it('no call reads the observation-filtered workspace list', async () => {
    const client = fakeClient();
    const { handle } = startWith(client);
    client.snapshot(['/a']);
    await handle.stop();

    expect(client.wsClient.query).not.toHaveBeenCalled();
    expect(client.subscriptions.some((sub) => sub.name === OBSERVATION_LIST)).toBe(false);
  });

  it('a workspace registered after startup still gets its pending request served', async () => {
    const client = fakeClient();
    const { handle, events } = startWith(client);
    client.snapshot(['/a']);

    // The workspace is registered later, and its request was already pending when its watch starts.
    client.snapshot(['/a', '/registered-later']);
    client.pending('/registered-later', [{ _id: 'req-pre-existing' }]);

    expect(gitRequests(events, 'req-pre-existing')).toHaveLength(1);
    await handle.stop();
  });

  it('the first membership snapshot triggers one startup drain, and later snapshots do not', async () => {
    const client = fakeClient();
    const { handle, events } = startWith(client);

    client.snapshot(['/a']);
    client.snapshot(['/a', '/b']);
    client.snapshot(['/b']);

    expect(gitRequests(events, STARTUP_DRAIN)).toHaveLength(1);
    await handle.stop();
  });
});
