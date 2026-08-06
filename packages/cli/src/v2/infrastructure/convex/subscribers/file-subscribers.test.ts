import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startFileContentRequestSubscriber } from './file-content-request.js';
import { startFileTreeRequestSubscriber } from './file-tree-request.js';
import { startFileWriteRequestSubscriber } from './file-write-request.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { FileInboundEvent } from '../../../domain/usecase/handle-file-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const FILE_TREE_REQUEST_ID = 'file_tree_req_1';
const FILE_CONTENT_REQUEST_ID = 'file_content_req_1';
const FILE_WRITE_REQUEST_ID = 'file_write_req_1';
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

describe('file v2 subscribers', () => {
  it('file-tree subscriber emits file-tree.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startFileTreeRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: FILE_TREE_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'file-tree.request',
      requestId: FILE_TREE_REQUEST_ID,
    });
  });

  it('file-content subscriber emits file-content.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startFileContentRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: FILE_CONTENT_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'file-content.request',
      requestId: FILE_CONTENT_REQUEST_ID,
    });
  });

  it('file-write subscriber emits file-write.request with requestId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startFileWriteRequestSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: FILE_WRITE_REQUEST_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'file-write.request',
      requestId: FILE_WRITE_REQUEST_ID,
    });
  });

  it('registry routes file event to handler', async () => {
    const handled: FileInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        assignedTask: {},
        directHarness: {},
        command: {},
        workspaceGit: {},
        file: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        agenticQuery: {},
        enhancer: {},
      },
    });

    emitUpdate([{ _id: FILE_TREE_REQUEST_ID }]);
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'file-tree.request',
      requestId: FILE_TREE_REQUEST_ID,
    });
  });

  it('event router dispatches file events to handler', async () => {
    const handled: FileInboundEvent[] = [];

    await routeInboundEvent(
      {
        assignedTask: {},
        directHarness: {},
        command: {},
        workspaceGit: {},
        file: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        agenticQuery: {},
        enhancer: {},
      },
      { type: 'file-write.request', requestId: FILE_WRITE_REQUEST_ID }
    );

    expect(handled).toEqual([{ type: 'file-write.request', requestId: FILE_WRITE_REQUEST_ID }]);
  });

  it('default router deps provide deliverInbound hook', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.file.deliverInbound).toBeTypeOf('function');
  });
});
