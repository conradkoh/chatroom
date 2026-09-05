import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startGitRequestSubscriber } from './git-request.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { WorkspaceGitInboundEvent } from '../../../domain/usecase/handle-workspace-git-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';
import {
  registerTaskInboxRoomMembershipRefresh,
  unregisterTaskInboxRoomMembershipRefresh,
} from '../../../entry/task-inbox-membership-registry.js';

const GIT_REQUEST_ID = 'git_req_1';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

const DEFAULT_WORKSPACES = [
  {
    _id: 'ws-1',
    chatroomId: 'chatroom-1',
    workingDir: '/a',
    hostname: 'h',
    registeredAt: 1,
    registeredBy: 'user',
  },
];

function createMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];

  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue(DEFAULT_WORKSPACES),
    mutation: vi.fn().mockResolvedValue(null),
  } as unknown as ConvexClient;

  return {
    wsClient,
    emitUpdate: (result: unknown) => {
      for (const callback of callbacks) {
        callback(result);
      }
    },
  };
}

const gitWatchArgs = (call: unknown[]) =>
  call[1] != null && typeof call[1] === 'object' && 'workingDir' in (call[1] as object);

const workspaceView = (workingDir: string) => ({
  _id: `ws-${workingDir}`,
  chatroomId: `chatroom-${workingDir}`,
  workingDir,
  hostname: 'h',
  registeredAt: 1,
  registeredBy: 'user',
});

describe('workspace-git v2 subscribers', () => {
  it('git-request subscriber emits git.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { sessionId: SESSION_ID, machineId: MACHINE_ID, workingDir: '/a' },
      expect.any(Function),
      expect.any(Function)
    );

    emitUpdate([{ _id: GIT_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'git.request',
      requestId: GIT_REQUEST_ID,
    });
  });

  it('registry routes git.request to workspace-git handler', async () => {
    const handled: WorkspaceGitInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
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
        enhancer: {},
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    emitUpdate([{ _id: GIT_REQUEST_ID }]);
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'git.request',
      requestId: GIT_REQUEST_ID,
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
        enhancer: {},
      },
      { type: 'git.request', requestId: GIT_REQUEST_ID }
    );

    expect(handled).toEqual([{ type: 'git.request', requestId: GIT_REQUEST_ID }]);
  });

  it('deduplicates workspaces sharing a workingDir into a single watch', async () => {
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockResolvedValue([workspaceView('/a'), workspaceView('/a')]);
    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));

    const gitCalls = vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs);
    expect(gitCalls).toHaveLength(1);
    expect(gitCalls[0][1]).toMatchObject({ workingDir: '/a' });
    await handle.stop();
  });

  it('refreshWorkspaces adds and removes only the workspace delta', async () => {
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockResolvedValue([workspaceView('/a')]);
    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs)).toHaveLength(1);

    vi.mocked(wsClient.query).mockResolvedValue([workspaceView('/a'), workspaceView('/b')]);
    await handle.refreshWorkspaces();
    const afterAdd = vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs);
    expect(afterAdd).toHaveLength(2);
    expect(afterAdd[1][1]).toMatchObject({ workingDir: '/b' });

    vi.mocked(wsClient.query).mockResolvedValue([workspaceView('/b')]);
    const unsubForA = vi.mocked(wsClient.onUpdate).mock.results[0].value as () => void;
    await handle.refreshWorkspaces();
    expect(unsubForA).toHaveBeenCalled();
    expect(vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs)).toHaveLength(2);
    await handle.stop();
  });

  it('failed refresh logs and preserves existing watches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockRejectedValueOnce(new Error('boom'));
    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(warn).toHaveBeenCalled();
    vi.mocked(wsClient.query).mockResolvedValue(DEFAULT_WORKSPACES);
    await handle.refreshWorkspaces();
    expect(vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs)).toHaveLength(1);
    warn.mockRestore();
    await handle.stop();
  });

  it('stop prevents an in-flight refresh from installing watches', async () => {
    let release!: () => void;
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockImplementation(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return DEFAULT_WORKSPACES;
    });
    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs)).toHaveLength(0);
  });

  it('refresh requested during an in-flight refresh performs a trailing reconciliation', async () => {
    const { wsClient } = createMockWsClient();
    const gates: (() => void)[] = [];
    let queryCount = 0;
    vi.mocked(wsClient.query).mockImplementation(async () => {
      const index = queryCount++;
      if (index < 3) {
        await new Promise<void>((r) => {
          gates.push(r);
        });
      }
      return DEFAULT_WORKSPACES;
    });

    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
    // Startup refresh is in flight on gates[0].
    const first = handle.refreshWorkspaces();
    const second = handle.refreshWorkspaces();

    gates[0]();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Queued re-run is now in flight on gates[1]; queue a trailing run.
    void handle.refreshWorkspaces();
    gates[1]();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Trailing run completes on gates[2].
    gates[2]();
    await first;
    await second;
    await new Promise((r) => setTimeout(r, 0));

    expect(queryCount).toBe(3);
    expect(vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs)).toHaveLength(1);
    await handle.stop();
  });

  it('events from different child watches preserve global request-id dedup', async () => {
    const events: InboundEvent[] = [];
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockResolvedValue([workspaceView('/a'), workspaceView('/b')]);
    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    await new Promise((r) => setTimeout(r, 0));

    const calls = vi.mocked(wsClient.onUpdate).mock.calls.filter(gitWatchArgs);
    expect(calls).toHaveLength(2);
    const watchFor = (workingDir: string) =>
      calls.find((call) => (call[1] as { workingDir: string }).workingDir === workingDir)![2] as (
        result: unknown
      ) => void;

    watchFor('/a')([{ _id: GIT_REQUEST_ID }]);
    watchFor('/b')([{ _id: GIT_REQUEST_ID }]);

    expect(events.filter((event) => event.type === 'git.request')).toHaveLength(1);
    await handle.stop();
  });

  it('claimed daemon.workspaceListChanged nudges the git workspace refresh', async () => {
    const refreshTaskInboxRooms = vi.fn().mockResolvedValue(undefined);
    registerTaskInboxRoomMembershipRefresh(refreshTaskInboxRooms);
    const entries: {
      args: unknown;
      cb: (r: unknown) => void;
    }[] = [];
    let currentWorkspaces = [workspaceView('/a')];
    const query = vi.fn(async () => currentWorkspaces);
    const mutation = vi.fn().mockResolvedValue(null);
    const onUpdate = vi.fn((_q: unknown, args: unknown, cb: (r: unknown) => void) => {
      entries.push({ args, cb });
      return vi.fn();
    });
    const wsClient = { onUpdate, query, mutation } as unknown as ConvexClient;

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        command: {},
        workspaceGit: { deliverInbound: async () => {} },
        file: {},
        agenticQuery: {},
        enhancer: {},
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const gitCalls = () => entries.filter((e) => gitWatchArgs([null, e.args]));
    expect(gitCalls()).toHaveLength(1);

    currentWorkspaces = [workspaceView('/a'), workspaceView('/b')];
    const watchNext = entries.find((e) => !gitWatchArgs([null, e.args]))!;
    mutation.mockResolvedValueOnce({
      commandId: 'cmd-ws',
      machineId: MACHINE_ID,
      type: 'daemon.workspaceListChanged',
      deadline: Date.now() + 60_000,
      timestamp: Date.now(),
    });
    watchNext.cb({ commandId: 'cmd-ws' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(gitCalls()).toHaveLength(2);
    expect(gitCalls()[1].args).toMatchObject({ workingDir: '/b' });
    expect(refreshTaskInboxRooms).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalled();
    await registry.stopAll();
    unregisterTaskInboxRoomMembershipRefresh();
  });

  it('default router deps provide deliverInbound hook', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.workspaceGit.deliverInbound).toBeTypeOf('function');
  });
});
