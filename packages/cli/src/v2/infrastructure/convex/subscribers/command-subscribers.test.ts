import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startCommandEventsSubscriber } from './command-events.js';
import { startCommandRunSubscriber } from './command-run.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { CommandInboundEvent } from '../../../domain/usecase/handle-command-inbound.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const COMMAND_EVENT_ID = 'cmd_event_1';
const PENDING_RUN_ID = 'run_pending_1';
const STOP_RUN_ID = 'run_stop_1';
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

describe('command v2 subscribers', () => {
  it('command-events subscriber emits command.received with commandId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startCommandEventsSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ events: [{ _id: COMMAND_EVENT_ID }] });
    await handle.stop();

    expect(events).toContainEqual({
      type: 'command.received',
      commandId: COMMAND_EVENT_ID,
    });
  });

  it('command-events subscriber dedupes repeated event ids', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startCommandEventsSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ events: [{ _id: COMMAND_EVENT_ID }] });
    emitUpdate({ events: [{ _id: COMMAND_EVENT_ID }] });
    await handle.stop();

    expect(events).toEqual([{ type: 'command.received', commandId: COMMAND_EVENT_ID }]);
  });

  it('command-run subscriber emits command-run.updated for pendingRuns', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startCommandRunSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ pendingRuns: [{ _id: PENDING_RUN_ID }] });
    await handle.stop();

    expect(events).toContainEqual({
      type: 'command-run.updated',
      runId: PENDING_RUN_ID,
    });
  });

  it('command-run subscriber emits command-run.updated for stopRequestedRuns', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startCommandRunSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ stopRequestedRuns: [{ _id: STOP_RUN_ID }] });
    await handle.stop();

    expect(events).toContainEqual({
      type: 'command-run.updated',
      runId: STOP_RUN_ID,
    });
  });

  it('registry routes command event to handler', async () => {
    const handled: CommandInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        assignedTask: {},
        directHarness: {},
        command: {
          onCommandEvent: async (event) => {
            handled.push(event);
          },
        },
      },
    });

    emitUpdate({ events: [{ _id: COMMAND_EVENT_ID }] });
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'command.received',
      commandId: COMMAND_EVENT_ID,
    });
  });

  it('event router dispatches command events to handler', async () => {
    const handled: CommandInboundEvent[] = [];

    await routeInboundEvent(
      {
        assignedTask: {},
        directHarness: {},
        command: {
          onCommandEvent: async (event) => {
            handled.push(event);
          },
        },
      },
      { type: 'command-run.updated', runId: PENDING_RUN_ID }
    );

    expect(handled).toEqual([{ type: 'command-run.updated', runId: PENDING_RUN_ID }]);
  });
});
