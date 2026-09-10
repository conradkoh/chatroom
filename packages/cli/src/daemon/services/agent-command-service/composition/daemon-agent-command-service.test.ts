import { describe, expect, it, vi } from 'vitest';

import { createDaemonAgentCommandServiceRuntime } from './daemon-agent-command-service.js';

const inbox = vi.hoisted(() => ({
  claimNext: vi.fn(),
  acknowledge: vi.fn(),
  renew: vi.fn(),
  subscribe: vi.fn(),
}));
const outbox = vi.hoisted(() => ({
  append: vi.fn(),
  flushNow: vi.fn(),
  stopAll: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());
const consumer = vi.hoisted(() => vi.fn());

vi.mock('../../../infrastructure/convex/agent-command-inbox.js', () => ({
  createAgentCommandInbox: vi.fn(() => inbox),
}));
vi.mock('../../../infrastructure/outbox/agent-command-fact-outbox.js', () => ({
  createAgentCommandFactOutbox: vi.fn(() => outbox),
}));
vi.mock('../../../infrastructure/outbox/agent-command-fact-send.js', () => ({
  createAgentCommandFactSend: vi.fn(() => send),
}));
vi.mock('../service/agent-command-inbox-consumer.js', () => ({
  startAgentCommandInboxConsumer: vi.fn((deps: { service: unknown }) => {
    consumer(deps.service);
    return { stop: vi.fn().mockResolvedValue(undefined) };
  }),
}));

function createService() {
  const processManager = {
    listActive: () => [{ chatroomId: 'room-1', role: 'builder', slot: { pid: 12 } }],
    stopAgent: vi.fn(async () => ({
      status: 'succeeded' as const,
      eventId: 'event-1',
      operationId: 'operation-1',
      messageId: 'message-1',
      messageGroupId: 'room-1:builder',
      body: {},
      completedAt: 1,
      receiveCount: 1,
    })),
  };
  return createDaemonAgentCommandServiceRuntime({
    wsClient: {} as never,
    backend: { mutation: vi.fn() },
    sessionId: 'session-1',
    machineId: 'machine-1',
    processManager: processManager as never,
  });
}

describe('daemon agent command service', () => {
  it('owns transport startup/shutdown and exposes materialized state', async () => {
    const service = createService();
    const states: string[] = [];
    service.subscribe((state) => states.push(state.status));

    await service.start();
    expect(states).toContain('starting');
    expect(states.at(-1)).toBe('running');
    expect(consumer).toHaveBeenCalledTimes(1);

    await service.stop();
    expect(outbox.stopAll).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('stopped');
  });

  it('does not expose transport handles through the public façade', () => {
    const service = createService();
    expect(Object.keys(service).sort()).toEqual(['getState', 'start', 'stop', 'subscribe']);
  });
});
