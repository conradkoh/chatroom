import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { startDirectHarnessCommandSubscriber } from './direct-harness-command.js';
import { startDirectHarnessPromptSubscriber } from './direct-harness-prompt.js';
import { startDirectHarnessSessionSubscriber } from './direct-harness-session.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { DirectHarnessInboundEvent } from '../../../domain/usecase/handle-direct-harness-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const HARNESS_SESSION_ID = 'nh7dh7bj63fdns9zkyasjgnga58afx3s';
const COMMAND_ID = 'cmd_pending_1';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

function createMockWsClient(queryResult: unknown = null) {
  const callbacks: ((result: unknown) => void)[] = [];

  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue(queryResult),
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

describe('direct-harness v2 subscribers', () => {
  it('session subscriber emits direct-harness.session-opened InboundEvent', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startDirectHarnessSessionSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: HARNESS_SESSION_ID }]);

    await handle.stop();

    expect(events).toContainEqual({
      type: 'direct-harness.session-opened',
      harnessSessionId: HARNESS_SESSION_ID,
    });
  });

  it('session subscriber dedupes repeated session ids', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startDirectHarnessSessionSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ _id: HARNESS_SESSION_ID }]);
    emitUpdate([{ _id: HARNESS_SESSION_ID }]);

    await handle.stop();

    expect(events).toEqual([
      { type: 'direct-harness.session-opened', harnessSessionId: HARNESS_SESSION_ID },
    ]);
  });

  it('prompt subscriber emits direct-harness.prompt after query returns messages', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient({
      messages: [{ harnessSessionId: HARNESS_SESSION_ID, content: 'hello', seq: 1 }],
    });

    const handle = startDirectHarnessPromptSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate(null);
    await Effect.runPromise(Effect.sleep('80 millis'));
    await handle.stop();

    expect(events).toContainEqual({
      type: 'direct-harness.prompt',
      harnessSessionId: HARNESS_SESSION_ID,
    });
  });

  it('command subscriber emits direct-harness.command with commandId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient([{ _id: COMMAND_ID }]);

    const handle = startDirectHarnessCommandSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate(null);
    await Effect.runPromise(Effect.sleep('80 millis'));
    await handle.stop();

    expect(events).toContainEqual({
      type: 'direct-harness.command',
      commandId: COMMAND_ID,
    });
  });

  it('registry routes direct-harness event to handler', async () => {
    const handled: DirectHarnessInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        directHarness: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {},
        enhancer: {},
      },
    });

    emitUpdate([{ _id: HARNESS_SESSION_ID }]);
    await Effect.runPromise(Effect.sleep('80 millis'));
    await registry.stopAll();

    expect(handled).toContainEqual({
      type: 'direct-harness.session-opened',
      harnessSessionId: HARNESS_SESSION_ID,
    });
  });

  it('event router dispatches direct-harness events to handler', async () => {
    const handled: DirectHarnessInboundEvent[] = [];

    await routeInboundEvent(
      {
        directHarness: {
          deliverInbound: async (event) => {
            handled.push(event);
          },
        },
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {},
        enhancer: {},
      },
      { type: 'direct-harness.command', commandId: COMMAND_ID }
    );

    expect(handled).toEqual([{ type: 'direct-harness.command', commandId: COMMAND_ID }]);
  });

  it('default router deps provide deliverInbound hook', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.directHarness.deliverInbound).toBeTypeOf('function');
  });
});
