import { DatabaseSync } from 'node:sqlite';

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
  it('replays durable facts after restart without another enqueue or explicit flush', async () => {
    const machineId = `test-auto-replay-${Date.now()}-${Math.random()}`;
    const key = 'machine:room:builder';
    const send = vi.fn(() => new Promise<{ success: true }>(() => {}));
    const registry = createAgentLifecycleOutboxRegistry(machineId, () => send);
    await expect(registry.enqueue(key, fact('builder'))).resolves.toEqual({ success: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await registry.stopAll();
    const recoveredSend = vi.fn(async () => ({ success: true as const }));
    const recovered = createAgentLifecycleOutboxRegistry(machineId, () => recoveredSend);
    await vi.waitFor(() => expect(recoveredSend).toHaveBeenCalledOnce());
    await recovered.stopAll();
    const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
    expect(store.listPendingForRecovery(key)).toEqual([]);
    store.close();
  });

  it.each([
    { kind: 'obsolete' },
    { ...fact('builder'), pid: 'not-a-number' },
    { ...fact('builder'), obsoleteField: 'old-schema' },
  ])(
    'quarantines an unsupported persisted schema and delivers its successor: %j',
    async (invalid) => {
      const machineId = `test-invalid-${Date.now()}-${Math.random()}`;
      const path = resolveOutboxDbPath(machineId, 'agent-lifecycle');
      const key = 'machine:room:builder';
      const store = openDurableFifoQueueStore(path);
      store.enqueue(key, JSON.stringify(invalid));
      store.enqueue(key, JSON.stringify(fact('builder')));
      store.close();
      const send = vi.fn(async () => ({ success: true as const }));
      const registry = createAgentLifecycleOutboxRegistry(machineId, () => send, {
        logger: { error: vi.fn() },
      });
      await registry.flushNow();
      expect(send).toHaveBeenCalledOnce();
      await registry.stopAll();
      const db = new DatabaseSync(path);
      expect(db.prepare('SELECT status, payload_json FROM fifo_outbox_entries').all()).toEqual([
        { status: 'quarantined', payload_json: JSON.stringify(invalid) },
      ]);
      db.close();
    }
  );
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
    await registry.flushNow();
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
    await registry.flushNow();
    expect(send).not.toHaveBeenCalled();
    await registry.stopAll();
  });

  it('acknowledges persistence and retries transient delivery failures', async () => {
    vi.useFakeTimers();
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
    await expect(result).resolves.toEqual({ success: true });
    await vi.runOnlyPendingTimersAsync();
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);
    await registry.stopAll();
    vi.useRealTimers();
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

  it('replays a persisted fact after reconnect and acknowledges it only after delivery', async () => {
    const machineId = `test-reconnect-${Date.now()}-${Math.random()}`;
    const key = 'machine:room:builder';
    const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
    store.enqueue(key, JSON.stringify(fact('builder')));
    store.close();

    const send = vi.fn(async () => ({ success: true as const }));
    const registry = createAgentLifecycleOutboxRegistry(machineId, () => send);
    await registry.flushNow(key);
    expect(send).toHaveBeenCalledTimes(1);
    await registry.stopAll();

    const reopened = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
    expect(reopened.listPendingForRecovery(key)).toEqual([]);
    reopened.close();
  });
});
