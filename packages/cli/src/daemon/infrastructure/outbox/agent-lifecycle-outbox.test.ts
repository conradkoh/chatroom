import { describe, expect, it, vi } from 'vitest';

import { createAgentLifecycleOutboxRegistry } from './agent-lifecycle-outbox.js';
import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';

const fact = (role: string): AgentLifecycleFact => ({
  kind: 'spawned',
  chatroomId: 'room',
  role,
  pid: 1,
  revisionKey: `${role}:1`,
  emittedAt: Date.now(),
});

describe('agent lifecycle outbox', () => {
  it('delivers facts and keeps role keys independent', async () => {
    const send = vi.fn(async () => ({ success: true as const }));
    const registry = createAgentLifecycleOutboxRegistry(
      `test-${Date.now()}-${Math.random()}`,
      () => send
    );
    await Promise.all([
      registry.enqueue('machine:room:builder', fact('builder')),
      registry.enqueue('machine:room:planner', fact('planner')),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    await registry.stopAll();
  });

  it('uses machine key for clear-all facts', async () => {
    const send = vi.fn(async () => ({ success: true as const }));
    const registry = createAgentLifecycleOutboxRegistry(
      `test-${Date.now()}-${Math.random()}`,
      (key) => async (item) => {
        expect(key).toContain('__machine__');
        expect(item.kind).toBe('cleared_all_pids');
        return { success: true };
      }
    );
    await registry.enqueue('machine:__machine__', {
      kind: 'cleared_all_pids',
      revisionKey: 'clear:1',
      emittedAt: Date.now(),
    });
    expect(send).not.toHaveBeenCalled();
    await registry.stopAll();
  });

  it('retries failed sends', async () => {
    let attempts = 0;
    const registry = createAgentLifecycleOutboxRegistry(
      `test-${Date.now()}-${Math.random()}`,
      () => async () => {
        attempts++;
        if (attempts === 1) throw new Error('temporary');
        return { success: true };
      }
    );
    const result = registry.enqueue('machine:room:builder', fact('builder'));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(attempts).toBeGreaterThanOrEqual(2);
    await result;
    await registry.stopAll();
  });

  it('strips legacy audit fields when replaying persisted exited facts', async () => {
    const machineId = `test-legacy-${Date.now()}-${Math.random()}`;
    const legacyFact = {
      kind: 'exited',
      sessionId: 'sess',
      machineId: 'machine',
      chatroomId: 'room',
      role: 'builder',
      pid: 0,
      stopReason: 'user.stop',
      revisionKey: 'exited:legacy',
      emittedAt: 1_000,
    };
    const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
    store.enqueue('machine:room:builder', JSON.stringify(legacyFact));
    store.close();

    const send = vi.fn(async (item: AgentLifecycleFact) => {
      expect(item).not.toHaveProperty('sessionId');
      expect(item).not.toHaveProperty('machineId');
      return { success: true as const };
    });
    const registry = createAgentLifecycleOutboxRegistry(machineId, () => send);
    await registry.flushNow('machine:room:builder');
    expect(send).toHaveBeenCalledTimes(1);
    await registry.stopAll();
  });
});
