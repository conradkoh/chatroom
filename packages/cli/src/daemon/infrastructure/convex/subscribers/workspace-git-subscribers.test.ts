import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startGitRequestSubscriber } from './git-request.js';
import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { WorkspaceGitInboundEvent } from '../../../domain/usecase/handle-workspace-git-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const GIT_REQUEST_ID = 'git_req_1';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

const MEMBERSHIP = getFunctionName(api.workspaces.listRegisteredWorkingDirsForMachine);
const PENDING = getFunctionName(api.workspaces.getPendingRequestsForWorkspace);
const OBSERVATION_LIST = getFunctionName(api.workspaces.listWorkspacesForMachine);

type Subscription = {
  name: string;
  args: Record<string, unknown>;
  callback: (result: unknown) => void;
  active: boolean;
  unsubscribe: ReturnType<typeof vi.fn>;
};

/**
 * Fake Convex client that routes each `onUpdate` by query name. The membership subscription and the
 * per-workspace pending-request watches are driven separately, as the server would.
 */
function createMockWsClient() {
  const subscriptions: Subscription[] = [];
  const wsClient = {
    onUpdate: vi.fn(
      (
        query: unknown,
        args: Record<string, unknown>,
        callback: (result: unknown) => void
      ): (() => void) => {
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

  const activeOf = (name: string) => subscriptions.filter((sub) => sub.name === name && sub.active);
  return {
    wsClient,
    subscriptions,
    /** Delivers a membership snapshot to every active membership subscription. */
    emitMembership(workingDirs: unknown) {
      for (const sub of activeOf(MEMBERSHIP)) sub.callback(workingDirs);
    },
    /** Delivers pending requests to the watch for `workingDir`. */
    emitPending(workingDir: string, requests: unknown[]) {
      for (const sub of activeOf(PENDING)) {
        if (sub.args.workingDir === workingDir) sub.callback(requests);
      }
    },
    /** Every pending-request watch ever created for `workingDir`, active or not. */
    watchesFor(workingDir: string) {
      return subscriptions.filter(
        (sub) => sub.name === PENDING && sub.args.workingDir === workingDir
      );
    },
  };
}

describe('workspace-git v2 subscribers', () => {
  it('git-request subscriber emits git.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();

    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    mock.emitMembership(['/a']);

    expect(mock.wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { sessionId: SESSION_ID, machineId: MACHINE_ID, workingDir: '/a' },
      expect.any(Function),
      expect.any(Function)
    );

    mock.emitPending('/a', [{ _id: GIT_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({ type: 'git.request', requestId: GIT_REQUEST_ID });
  });

  it('registry routes git.request to workspace-git handler', () => {
    const handled: WorkspaceGitInboundEvent[] = [];
    const mock = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient: mock.wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        command: {},
        workspaceGit: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        file: {},
        agenticQuery: {},
      },
    });
    mock.emitMembership(['/a']);
    mock.emitPending('/a', [{ _id: GIT_REQUEST_ID }]);

    return registry.stopAll().then(() => {
      expect(handled).toContainEqual({ type: 'git.request', requestId: GIT_REQUEST_ID });
    });
  });

  it('event router dispatches workspace-git events to handler', async () => {
    const handled: WorkspaceGitInboundEvent[] = [];

    await routeInboundEvent(
      {
        command: {},
        workspaceGit: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        file: {},
        agenticQuery: {},
      },
      { type: 'git.request', requestId: GIT_REQUEST_ID }
    );

    expect(handled).toEqual([{ type: 'git.request', requestId: GIT_REQUEST_ID }]);
  });

  it('deduplicates workspaces sharing a workingDir into a single watch', async () => {
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    mock.emitMembership(['/a', '/a']);

    expect(mock.watchesFor('/a')).toHaveLength(1);
    await handle.stop();
  });

  it('a membership snapshot adds and removes only the workspace delta, without restarting', async () => {
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    mock.emitMembership(['/a']);
    expect(mock.watchesFor('/a')).toHaveLength(1);

    mock.emitMembership(['/a', '/b']);
    expect(mock.watchesFor('/a')).toHaveLength(1);
    expect(mock.watchesFor('/b')).toHaveLength(1);

    mock.emitMembership(['/b']);
    const [watchA] = mock.watchesFor('/a');
    expect(watchA.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mock.watchesFor('/b')).toHaveLength(1);
    await handle.stop();
  });

  it('a membership payload that is not an array of strings keeps the existing watches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    mock.emitMembership(['/a']);

    mock.emitMembership({ workingDir: '/a' });

    expect(warn).toHaveBeenCalled();
    expect(mock.watchesFor('/a')).toHaveLength(1);
    expect(mock.watchesFor('/a')[0].unsubscribe).not.toHaveBeenCalled();
    warn.mockRestore();
    await handle.stop();
  });

  it('stop unsubscribes the membership subscription and every watch', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    mock.emitMembership(['/a', '/b']);

    await handle.stop();
    mock.emitMembership(['/c']);
    mock.emitPending('/a', [{ _id: GIT_REQUEST_ID }]);

    expect(mock.subscriptions.filter((sub) => sub.name === MEMBERSHIP && sub.active)).toHaveLength(
      0
    );
    expect(mock.subscriptions.filter((sub) => sub.name === PENDING && sub.active)).toHaveLength(0);
    expect(
      events.filter((event) => event.type === 'git.request' && event.requestId === GIT_REQUEST_ID)
    ).toHaveLength(0);
  });

  it('events from different child watches preserve global request-id dedup', async () => {
    const events: InboundEvent[] = [];
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    mock.emitMembership(['/a', '/b']);

    mock.emitPending('/a', [{ _id: GIT_REQUEST_ID }]);
    mock.emitPending('/b', [{ _id: GIT_REQUEST_ID }]);

    expect(
      events.filter((event) => event.type === 'git.request' && event.requestId === GIT_REQUEST_ID)
    ).toHaveLength(1);
    await handle.stop();
  });

  it('never reads the observation-filtered workspace list', async () => {
    const mock = createMockWsClient();
    const handle = startGitRequestSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    mock.emitMembership(['/a']);

    expect(mock.wsClient.query).not.toHaveBeenCalled();
    expect(mock.subscriptions.some((sub) => sub.name === OBSERVATION_LIST)).toBe(false);
    await handle.stop();
  });

  it('default router deps provide deliverInbound hook', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.workspaceGit.deliverInbound).toBeTypeOf('function');
  });
});
