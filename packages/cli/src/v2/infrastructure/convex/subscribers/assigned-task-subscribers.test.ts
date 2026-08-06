import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { startAssignedTaskPresenceSubscriber } from './assigned-task-presence.js';
import { startAssignedTaskSignalsSubscriber } from './assigned-task-signals.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { AssignedTaskInboundEvent } from '../../../domain/usecase/handle-assigned-task-inbound.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const TASK_ID = 'nh7dh7bj63fdns9zkyasjgnga58afx3s';
const CHATROOM_ID = 'n57ctdnfvd0avh0ghx6p4szk8x8aa69a';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

function makeSignalItem() {
  return {
    taskId: TASK_ID,
    chatroomId: CHATROOM_ID,
    role: 'builder',
    status: 'pending' as const,
    signalType: 'task' as const,
    revisionKey: 'rev-1',
    machineId: MACHINE_ID,
    agentHarness: 'cursor-sdk',
    createdAt: 1_000,
  };
}

function makePresenceItem() {
  return {
    taskId: TASK_ID,
    chatroomId: CHATROOM_ID,
    role: 'builder',
    lastSeenAt: 1_000,
    lastSeenAction: 'native.waiting',
    presenceUpdatedAt: 1_000,
    presenceKey: 'presence-1',
  };
}

function createMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];

  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue({ items: [], highKey: null, hasMore: false }),
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

describe('assigned-task v2 subscribers', () => {
  it('signal subscriber emits assigned-task.signal InboundEvent', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAssignedTaskSignalsSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({
      items: [makeSignalItem()],
      highKey: 'rev-1',
      hasMore: false,
    });

    await Effect.runPromise(Effect.sleep('80 millis'));
    await handle.stop();

    expect(events).toContainEqual({
      type: 'assigned-task.signal',
      taskId: TASK_ID,
      role: 'builder',
    });
  });

  it('presence subscriber emits assigned-task.presence InboundEvent', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAssignedTaskPresenceSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({
      items: [makePresenceItem()],
      highPresenceKey: 'presence-1',
      highPresenceAt: 1_000,
      hasMore: false,
    });

    await Effect.runPromise(Effect.sleep('80 millis'));
    await handle.stop();

    expect(events).toContainEqual({
      type: 'assigned-task.presence',
      taskId: TASK_ID,
      role: 'builder',
    });
  });

  it('registry routes subscriber events to assigned-task handler', async () => {
    const handled: AssignedTaskInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        assignedTask: {
          onTaskMonitorEvent: async (event) => {
            handled.push(event);
          },
        },
        directHarness: {},
      },
    });

    emitUpdate({
      items: [makeSignalItem()],
      highKey: 'rev-1',
      hasMore: false,
    });

    await Effect.runPromise(Effect.sleep('80 millis'));
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'assigned-task.signal',
      taskId: TASK_ID,
      role: 'builder',
    });
  });

  it('event router dispatches assigned-task events to handler', async () => {
    const handled: AssignedTaskInboundEvent[] = [];

    await routeInboundEvent(
      {
        assignedTask: {
          onTaskMonitorEvent: async (event) => {
            handled.push(event);
          },
        },
        directHarness: {},
      },
      { type: 'assigned-task.presence', taskId: TASK_ID, role: 'builder' }
    );

    expect(handled).toEqual([{ type: 'assigned-task.presence', taskId: TASK_ID, role: 'builder' }]);
  });
});
