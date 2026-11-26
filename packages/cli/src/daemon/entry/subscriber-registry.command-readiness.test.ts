import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerCommandInboundHandler,
  unregisterCommandInboundHandler,
} from './command-inbound-registry.js';
import { startAllSubscribers, type SubscriberRegistryDeps } from './subscriber-registry.js';
import { api } from '../../api.js';

const CLAIM = {
  commandId: 'cmd-start',
  machineId: 'machine-test',
  type: 'agent.requestStart' as const,
  chatroomId: 'room-1',
  role: 'planner',
  workingDir: '/workspace/a',
  deadline: Date.now() + 120_000,
  timestamp: Date.now(),
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Convex port fake: `claimNext` returns queued claims; every other call returns null. */
function createWsClient(claims: unknown[], onClaimNext?: () => void) {
  const mutation = vi.fn(async (ref: unknown) => {
    if (
      getFunctionName(ref as never) === getFunctionName(api.daemon.machineCommandInbox.claimNext)
    ) {
      onClaimNext?.();
      return claims.shift() ?? null;
    }
    return null;
  });
  const wsClient = {
    onUpdate: vi.fn(() => vi.fn()),
    mutation,
    query: vi.fn(async () => null),
  } as unknown as ConvexClient;
  return { wsClient, mutation };
}

const countCalls = (mutation: ReturnType<typeof vi.fn>, ref: unknown) =>
  mutation.mock.calls.filter(([c]) => getFunctionName(c as never) === getFunctionName(ref as never))
    .length;

// Other subscribers in startAllSubscribers need the deps shape; their routers are unused here.
function deps(wsClient: ConvexClient): SubscriberRegistryDeps {
  return {
    wsClient,
    sessionId: 'session-test' as SessionId,
    machineId: 'machine-test',
    router: {} as SubscriberRegistryDeps['router'],
  };
}

afterEach(() => {
  unregisterCommandInboundHandler();
  vi.restoreAllMocks();
});

describe('machine command readiness through startAllSubscribers', () => {
  it('holds a queued start command until the handler is registered, then runs and acknowledges it', async () => {
    const { wsClient, mutation } = createWsClient([CLAIM]);
    const handler = vi.fn(async () => {});
    const registry = startAllSubscribers(deps(wsClient)); // no handler yet
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(countCalls(mutation, api.daemon.machineCommandInbox.acknowledge)).toBe(0);
    expect(countCalls(mutation, api.daemon.machineCommandInbox.claimNext)).toBe(0);

    registerCommandInboundHandler(handler);
    await tick();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.received', commandId: 'cmd-start' })
    );
    expect(countCalls(mutation, api.daemon.machineCommandInbox.acknowledge)).toBe(1);
    await registry.stopAll();
  });

  it('leaves a claim unacknowledged when the handler is cleared between claim and dispatch', async () => {
    // Simulates shutdown racing a claim: the handler is cleared while claimNext is resolving.
    const { wsClient, mutation } = createWsClient([CLAIM], () => unregisterCommandInboundHandler());
    const handler = vi.fn(async () => {});
    registerCommandInboundHandler(handler);
    const registry = startAllSubscribers(deps(wsClient));
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(countCalls(mutation, api.daemon.machineCommandInbox.claimNext)).toBe(1);
    expect(countCalls(mutation, api.daemon.machineCommandInbox.acknowledge)).toBe(0);
    await registry.stopAll();
  });

  it('does not acknowledge agent.stop when no agent.stop handler is wired', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const STOP_CLAIM = { ...CLAIM, commandId: 'cmd-stop', type: 'agent.stop' as const };
    const { wsClient, mutation } = createWsClient([STOP_CLAIM]);
    const handler = vi.fn(async () => {});
    registerCommandInboundHandler(handler);
    const registry = startAllSubscribers(deps(wsClient)); // deps() has no onAgentStopCommand
    await tick();
    expect(handler).not.toHaveBeenCalled();
    // The drain loop claims until it gets a null, so the claim count is not fixed at one.
    expect(countCalls(mutation, api.daemon.machineCommandInbox.claimNext)).toBeGreaterThanOrEqual(
      1
    );
    expect(countCalls(mutation, api.daemon.machineCommandInbox.acknowledge)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cmd-stop failed'));
    await registry.stopAll();
  });
});
