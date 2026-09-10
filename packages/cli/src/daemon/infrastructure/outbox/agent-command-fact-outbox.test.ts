import { describe, expect, it, vi } from 'vitest';

import {
  agentCommandFactDeliveryKey,
  createAgentCommandFactOutbox,
} from './agent-command-fact-outbox.js';
import type { AgentCommandFactSendResult } from './agent-command-fact-outbox.js';
import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import type { AgentStoppedFact } from '../../services/agent-command-service/domain/entities/agent-fact.js';
import type { AgentFactSink } from '../../services/agent-command-service/service/ports/agent-fact-sink.js';

const uniqueMachineId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random()}`;

const stoppedFact = (overrides?: Partial<AgentStoppedFact>): AgentStoppedFact => ({
  kind: 'agent.stopped',
  eventId: 'agent.stopped:cmd-1:room-1:builder',
  intentId: 'intent-1',
  commandId: 'cmd-1',
  machineId: 'machine-1',
  chatroomId: 'room-1',
  role: 'builder',
  pid: 4242,
  outcome: 'stopped',
  reason: 'user.stop',
  occurredAt: 1500,
  ...overrides,
});

describe('agent command fact outbox', () => {
  it('implements AgentFactSink and append resolves without waiting for remote delivery', async () => {
    const machineId = uniqueMachineId('test-nonblocking');
    let resolveSend!: (result: AgentCommandFactSendResult) => void;
    const gate = new Promise<AgentCommandFactSendResult>((resolve) => {
      resolveSend = resolve;
    });
    const send = vi.fn(async () => gate);
    const outbox = createAgentCommandFactOutbox(machineId, () => send);
    const sink: AgentFactSink = outbox;

    // Resolves while the sender is still blocked: append is durable local
    // enqueue, not remote delivery.
    await sink.append(stoppedFact());
    expect(send).toHaveBeenCalledTimes(1);

    resolveSend({ success: true });
    await outbox.stopAll();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('delivers facts for distinct chatroom/role keys independently', async () => {
    const machineId = uniqueMachineId('test-keys');
    const seenKeys: string[] = [];
    const send = vi.fn(async (fact: AgentStoppedFact) => {
      expect(fact.kind).toBe('agent.stopped');
      return { success: true as const };
    });
    const outbox = createAgentCommandFactOutbox(machineId, (key) => async (fact) => {
      seenKeys.push(key);
      return send(fact);
    });

    const builderFact = stoppedFact({
      eventId: 'agent.stopped:cmd-1:room-1:builder',
      chatroomId: 'room-1',
      role: 'builder',
    });
    const { pid: _droppedPid, ...noPid } = stoppedFact();
    const plannerFact = {
      ...noPid,
      eventId: 'agent.stopped:cmd-1:room-2:planner',
      chatroomId: 'room-2',
      role: 'planner',
    };
    await outbox.append(builderFact);
    await outbox.append(plannerFact);
    await outbox.flushNow();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(builderFact);
    expect(send).toHaveBeenCalledWith(plannerFact);
    expect(seenKeys).toContain(agentCommandFactDeliveryKey(machineId, builderFact));
    expect(seenKeys).toContain(agentCommandFactDeliveryKey(machineId, plannerFact));
    await outbox.stopAll();
  });

  it('retries a thrown sender error and eventually succeeds', async () => {
    vi.useFakeTimers();
    const machineId = uniqueMachineId('test-retry');
    const errors: unknown[] = [];
    let attempts = 0;
    const outbox = createAgentCommandFactOutbox(
      machineId,
      () => async () => {
        attempts++;
        if (attempts === 1) throw new Error('temporary');
        return { success: true as const };
      },
      { onError: (_key, error) => errors.push(error) }
    );
    await outbox.append(stoppedFact());
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);
    expect(errors).toHaveLength(1);
    await outbox.stopAll();
    vi.useRealTimers();
  });

  it('normalizes role casing and whitespace in the delivery key only', () => {
    const fact = stoppedFact({ chatroomId: 'room-1', role: '  Builder ' });
    expect(agentCommandFactDeliveryKey('machine-1', fact)).toBe('machine-1:room-1:builder');
    expect(fact.role).toBe('  Builder ');
  });

  it('recovers a persisted fact from the distinct agent-command-fact database', async () => {
    const machineId = uniqueMachineId('test-durable');
    const dbPath = resolveOutboxDbPath(machineId, 'agent-command-fact');
    expect(dbPath).toMatch(/outbox-agent-command-fact\.sqlite$/);

    const fact = stoppedFact();
    const key = agentCommandFactDeliveryKey(machineId, fact);
    const store = openDurableFifoQueueStore(dbPath);
    store.enqueue(key, JSON.stringify(fact));
    store.close();

    const send = vi.fn(async () => ({ success: true as const }));
    const outbox = createAgentCommandFactOutbox(machineId, () => send);
    await outbox.flushNow(key);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(fact);
    await outbox.stopAll();
  });

  it('stopAll drains pending work and closes the database', async () => {
    const machineId = uniqueMachineId('test-stop');
    const send = vi.fn(async () => ({ success: true as const }));
    const outbox = createAgentCommandFactOutbox(machineId, () => send);
    const first = stoppedFact({ eventId: 'agent.stopped:cmd-1:room-1:builder' });
    const { pid: _droppedStopPid, ...noStopPid } = stoppedFact();
    const second = {
      ...noStopPid,
      eventId: 'agent.stopped:cmd-1:room-1:planner',
      role: 'planner',
    };
    await outbox.append(first);
    await outbox.append(second);
    await outbox.stopAll();
    expect(send).toHaveBeenCalledTimes(2);

    const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-command-fact'));
    expect(store.listPendingForRecovery(agentCommandFactDeliveryKey(machineId, first))).toEqual([]);
    expect(store.listPendingForRecovery(agentCommandFactDeliveryKey(machineId, second))).toEqual(
      []
    );
    store.close();

    // A stopped outbox no longer accepts work (registry store is closed).
    await expect(outbox.append(first)).rejects.toThrow();
  });
});
