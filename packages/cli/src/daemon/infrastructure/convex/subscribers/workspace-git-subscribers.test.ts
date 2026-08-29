import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startGitRequestSubscriber } from './git-request.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { WorkspaceGitInboundEvent } from '../../../domain/usecase/handle-workspace-git-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const GIT_REQUEST_ID = 'git_req_1';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

function createMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];

  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue(null),
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

describe('workspace-git v2 subscribers', () => {
  it('git-request subscriber emits git.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startGitRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: GIT_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'git.request',
      requestId: GIT_REQUEST_ID,
    });
  });

  it('registry routes workspace-git event to handler', async () => {
    const handled: WorkspaceGitInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        directHarness: {},
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

    emitUpdate(['ws-a']);
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'workspace.list-changed',
      machineId: MACHINE_ID,
    });
  });

  it('event router dispatches workspace-git events to handler', async () => {
    const handled: WorkspaceGitInboundEvent[] = [];

    await routeInboundEvent(
      {
        directHarness: {},
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

  it('default router deps provide deliverInbound hook', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.workspaceGit.deliverInbound).toBeTypeOf('function');
  });
});
