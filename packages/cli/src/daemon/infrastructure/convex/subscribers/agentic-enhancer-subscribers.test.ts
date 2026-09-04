import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startAgenticQueryPromptSubscriber } from './agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from './agentic-query-session.js';
import { startEnhancerJobSubscriber } from './enhancer-job.js';
import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { AgenticQueryInboundEvent } from '../../../domain/usecase/handle-agentic-query-inbound.js';
import type { EnhancerInboundEvent } from '../../../domain/usecase/handle-enhancer-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const RUN_ID = 'aq_run_1';
const JOB_ID = 'enhancer_job_1';
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

describe('agentic-query and enhancer v2 subscribers', () => {
  it('agentic-query session subscriber emits agentic-query.session-opened', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAgenticQuerySessionSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ runId: RUN_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'agentic-query.session-opened',
      sessionId: RUN_ID,
    });
  });

  it('agentic-query prompt subscriber emits agentic-query.prompt per runId with messages', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAgenticQueryPromptSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ messages: [{ runId: RUN_ID, content: 'hello' }] });
    await handle.stop();

    expect(events).toContainEqual({
      type: 'agentic-query.prompt',
      sessionId: RUN_ID,
    });
  });

  it('enhancer subscriber emits enhancer.job-assigned with jobId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      api.daemon.enhancer.index.pendingForChatroom,
      { sessionId: SESSION_ID, machineId: MACHINE_ID, chatroomId: 'chatroom-1' },
      expect.any(Function),
      expect.any(Function)
    );

    emitUpdate([{ jobId: JOB_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'enhancer.job-assigned',
      jobId: JOB_ID,
    });
  });

  it('registry routes agentic-query and enhancer events to handlers', async () => {
    const agenticHandled: AgenticQueryInboundEvent[] = [];
    const enhancerHandled: EnhancerInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {
          deliverInbound: async (event) => {
            agenticHandled.push(event);
          },
        },
        enhancer: {
          deliverInbound: async (event) => {
            enhancerHandled.push(event);
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    emitUpdate([{ runId: RUN_ID }]);
    emitUpdate([{ jobId: JOB_ID }]);
    await registry.stopAll();

    expect(agenticHandled).toContainEqual({
      type: 'agentic-query.session-opened',
      sessionId: RUN_ID,
    });
    expect(enhancerHandled).toContainEqual({
      type: 'enhancer.job-assigned',
      jobId: JOB_ID,
    });
  });
  it('deduplicates workspaces that share one chatroom into a single watch', async () => {
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockResolvedValue([
      {
        _id: 'ws-1',
        chatroomId: 'chatroom-1',
        workingDir: '/a',
        hostname: 'h',
        registeredAt: 1,
        registeredBy: 'user',
      },
      {
        _id: 'ws-2',
        chatroomId: 'chatroom-1',
        workingDir: '/b',
        hostname: 'h',
        registeredAt: 1,
        registeredBy: 'user',
      },
    ]);
    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));

    const enhancerCalls = vi.mocked(wsClient.onUpdate).mock.calls;
    expect(enhancerCalls).toHaveLength(1);
    expect(enhancerCalls[0][1]).toMatchObject({ chatroomId: 'chatroom-1' });
    await handle.stop();
  });

  it('refreshChatrooms adds and removes only the room delta', async () => {
    const workspace = (chatroomId: string) => ({
      _id: `ws-${chatroomId}`,
      chatroomId,
      workingDir: `/${chatroomId}`,
      hostname: 'h',
      registeredAt: 1,
      registeredBy: 'user',
    });
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockResolvedValue([workspace('room-1')]);
    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(wsClient.onUpdate).mock.calls).toHaveLength(1);

    vi.mocked(wsClient.query).mockResolvedValue([workspace('room-1'), workspace('room-2')]);
    await handle.refreshChatrooms();
    const afterAdd = vi.mocked(wsClient.onUpdate).mock.calls;
    expect(afterAdd).toHaveLength(2);
    expect(afterAdd[1][1]).toMatchObject({ chatroomId: 'room-2' });

    vi.mocked(wsClient.query).mockResolvedValue([workspace('room-2')]);
    const unsubForRoom1 = vi.mocked(wsClient.onUpdate).mock.results[0].value as () => void;
    await handle.refreshChatrooms();
    expect(unsubForRoom1).toHaveBeenCalled();
    expect(vi.mocked(wsClient.onUpdate).mock.calls).toHaveLength(2);
    await handle.stop();
  });

  it('failed refresh logs and preserves existing watches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wsClient } = createMockWsClient();
    vi.mocked(wsClient.query).mockRejectedValueOnce(new Error('boom'));
    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(warn).toHaveBeenCalled();
    vi.mocked(wsClient.query).mockResolvedValue(DEFAULT_WORKSPACES);
    await handle.refreshChatrooms();
    expect(vi.mocked(wsClient.onUpdate).mock.calls).toHaveLength(1);
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
    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(wsClient.onUpdate).mock.calls).toHaveLength(0);
  });
  it('claimed daemon.workspaceListChanged nudges the enhancer room refresh', async () => {
    const workspace = (chatroomId: string) => ({
      _id: `ws-${chatroomId}`,
      chatroomId,
      workingDir: `/${chatroomId}`,
      hostname: 'h',
      registeredAt: 1,
      registeredBy: 'user',
    });
    const entries: {
      query: unknown;
      args: unknown;
      cb: (r: unknown) => void;
      unsub: () => void;
    }[] = [];
    let currentRooms = [workspace('room-1')];
    const query = vi.fn(async () => currentRooms);
    const mutation = vi.fn().mockResolvedValue(null);
    const onUpdate = vi.fn((q: unknown, args: unknown, cb: (r: unknown) => void) => {
      entries.push({ query: q, args, cb, unsub: vi.fn() });
      return vi.fn();
    });
    const wsClient = { onUpdate, query, mutation } as unknown as ConvexClient;
    const hasChatroomId = (e: { args: unknown }) =>
      e.args != null && typeof e.args === 'object' && 'chatroomId' in (e.args as object);

    void startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {},
        enhancer: { deliverInbound: async () => {} },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const enhancerCalls = () => entries.filter(hasChatroomId);
    expect(enhancerCalls()).toHaveLength(1);

    currentRooms = [workspace('room-1'), workspace('room-2')];
    const watchNext = entries.find((e) => !hasChatroomId(e))!;
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

    expect(enhancerCalls()).toHaveLength(2);
    expect(enhancerCalls()[1].args).toMatchObject({ chatroomId: 'room-2' });
    expect(mutation).toHaveBeenCalled();
  });

  it('event router dispatches agentic-query and enhancer events to handlers', async () => {
    const agenticHandled: AgenticQueryInboundEvent[] = [];
    const enhancerHandled: EnhancerInboundEvent[] = [];

    await routeInboundEvent(
      {
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {
          deliverInbound: async (event) => {
            agenticHandled.push(event);
          },
        },
        enhancer: {
          deliverInbound: async (event) => {
            enhancerHandled.push(event);
          },
        },
      },
      { type: 'enhancer.job-assigned', jobId: JOB_ID }
    );

    expect(agenticHandled).toEqual([]);
    expect(enhancerHandled).toEqual([{ type: 'enhancer.job-assigned', jobId: JOB_ID }]);
  });

  it('default router deps provide deliverInbound hook for agentic query', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.agenticQuery.deliverInbound).toBeTypeOf('function');
  });

  it('default router deps provide deliverInbound hook for enhancer', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.enhancer.deliverInbound).toBeTypeOf('function');
  });
});
