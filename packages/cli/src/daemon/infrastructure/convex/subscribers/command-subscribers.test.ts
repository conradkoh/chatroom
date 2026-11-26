import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import {
  type MachineCommandReadiness,
  startMachineCommandInboxSubscriber,
} from './machine-command-inbox.js';
import { api } from '../../../../api.js';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';
const CLAIMED = {
  commandId: 'cmd-1',
  machineId: MACHINE_ID,
  type: 'daemon.ping' as const,
  deadline: Date.now() + 60_000,
  timestamp: Date.now(),
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const alwaysReady: MachineCommandReadiness = { isReady: () => true, onReady: () => () => {} };

/** Fake readiness port: the test controls when the daemon can run commands. */
function createReadinessGate(initiallyReady: boolean) {
  let ready = initiallyReady;
  const listeners = new Set<() => void>();
  return {
    port: {
      isReady: () => ready,
      onReady(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } satisfies MachineCommandReadiness,
    open() {
      ready = true;
      for (const listener of [...listeners]) listener();
    },
    close() {
      ready = false;
    },
  };
}

/** Counts calls to a Convex function by name. */
const callsTo = (mutation: unknown, ref: unknown) =>
  (mutation as { mock: { calls: unknown[][] } }).mock.calls.filter(
    ([called]) => getFunctionName(called as never) === getFunctionName(ref as never)
  ).length;
const CLAIM_NEXT = api.daemon.machineCommandInbox.claimNext;
const ACKNOWLEDGE = api.daemon.machineCommandInbox.acknowledge;
function createInboxMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];
  const claims: unknown[] = [];
  const mutation = vi.fn(async () => claims.shift() ?? null);
  const wsClient = {
    onUpdate: vi.fn((_q, _a, cb) => {
      callbacks.push(cb);
      return vi.fn();
    }),
    mutation,
    query: vi.fn(),
  } as unknown as ConvexClient;
  return {
    wsClient,
    mutation,
    emitWatch: (result: unknown) => callbacks.forEach((cb) => cb(result)),
    queueClaims: (...items: unknown[]) => claims.push(...items),
  };
}

describe('machine command inbox subscriber', () => {
  it('claims and forwards claimed command on watch nudge', async () => {
    const events: unknown[] = [];
    const mock = createInboxMockWsClient();
    mock.queueClaims(CLAIMED);
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      alwaysReady,
      async (c) => {
        events.push({ type: 'command.received', commandId: c.commandId, claimedCommand: c });
      }
    );
    await new Promise((r) => setTimeout(r, 0));
    mock.emitWatch({ commandId: CLAIMED.commandId });
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();
    expect(mock.mutation).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'command.received',
      commandId: CLAIMED.commandId,
      claimedCommand: CLAIMED,
    });
  });
  it('serializes the same agent while running different roles in the same workspace in parallel', async () => {
    const mock = createInboxMockWsClient();
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.queueClaims(
      {
        ...CLAIMED,
        commandId: 'a',
        type: 'agent.requestStart',
        chatroomId: 'room-1',
        role: 'planner',
        workingDir: '/workspace/a',
      },
      {
        ...CLAIMED,
        commandId: 'b',
        type: 'agent.restart',
        chatroomId: 'room-1',
        role: 'builder',
        workingDir: '/workspace/a',
      },
      {
        ...CLAIMED,
        commandId: 'c',
        type: 'agent.requestStart',
        chatroomId: 'room-1',
        role: 'planner',
        workingDir: '/workspace/a',
      }
    );
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      alwaysReady,
      async (c) => {
        seen.push(c.commandId);
        if (c.commandId === 'a') await gate;
      }
    );
    await new Promise((r) => setTimeout(r, 0));
    mock.emitWatch({ commandId: 'a' });
    mock.emitWatch({ commandId: 'b' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['a', 'b']);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['a', 'b', 'c']);
    await handle.stop();
  });

  it('claims nothing and acknowledges nothing while the command handler is not registered', async () => {
    const mock = createInboxMockWsClient();
    const gate = createReadinessGate(false);
    mock.queueClaims(CLAIMED);
    const onClaimed = vi.fn(async () => {});
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      gate.port,
      onClaimed
    );
    await tick();
    mock.emitWatch({ commandId: CLAIMED.commandId });
    await tick();
    expect(callsTo(mock.mutation, CLAIM_NEXT)).toBe(0);
    expect(onClaimed).not.toHaveBeenCalled();
    expect(callsTo(mock.mutation, ACKNOWLEDGE)).toBe(0);
    await handle.stop();
  });

  it('claims, runs and acknowledges the queued command once readiness turns on, with no watch nudge', async () => {
    const mock = createInboxMockWsClient();
    const gate = createReadinessGate(false);
    mock.queueClaims(CLAIMED);
    const onClaimed = vi.fn(async () => {});
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      gate.port,
      onClaimed
    );
    await tick();
    gate.open();
    await tick();
    expect(onClaimed).toHaveBeenCalledWith(CLAIMED);
    expect(callsTo(mock.mutation, ACKNOWLEDGE)).toBe(1);
    await handle.stop();
  });

  it('stops claiming once readiness is cleared', async () => {
    const mock = createInboxMockWsClient();
    const gate = createReadinessGate(true);
    const onClaimed = vi.fn(async () => {});
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      gate.port,
      onClaimed
    );
    await tick();
    const claimsBefore = callsTo(mock.mutation, CLAIM_NEXT);
    gate.close();
    mock.queueClaims(CLAIMED);
    mock.emitWatch({ commandId: CLAIMED.commandId });
    await tick();
    expect(callsTo(mock.mutation, CLAIM_NEXT)).toBe(claimsBefore);
    expect(onClaimed).not.toHaveBeenCalled();
    await handle.stop();
  });
});
