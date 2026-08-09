import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createPublisherRegistry } from './publisher-registry.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { createStreamHub } from '../local-web/server/stream-hub.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-publisher-registry-'));
  return join(dir, 'events.sqlite');
}

describe('createPublisherRegistry', () => {
  it('appends outbound events to persistence on publish', async () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      const registry = createPublisherRegistry({ persistence: store });
      await registry.publish({ type: 'heartbeat', machineId: 'm-1' });

      const pending = store.listPendingOutbox();
      expect(pending).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('fans harness.stream events to streamHub', async () => {
    const streamHub = createStreamHub();
    const received: string[] = [];
    streamHub.subscribe((event) => received.push(event.line));

    const registry = createPublisherRegistry({ streamHub });
    await registry.publish({
      type: 'harness.stream',
      harness: 'h1',
      stream: 'stdout',
      line: 'hello',
      timestamp: 1,
    });

    expect(received).toEqual(['hello']);
  });

  it('routes heartbeat events to convex publisher when backend deps provided', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const registry = createPublisherRegistry({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await registry.publish({ type: 'heartbeat', machineId: 'machine-1' });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });
  });

  it('no-ops convex routing when backend deps are absent', async () => {
    const registry = createPublisherRegistry();
    await expect(
      registry.publish({ type: 'heartbeat', machineId: 'm-1' })
    ).resolves.toBeUndefined();
  });

  it('routes heartbeat to convex by default (P1 cutover off)', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const registry = createPublisherRegistry({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await registry.publish({ type: 'heartbeat', machineId: 'machine-1' });

    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('skips direct convex publish when P1_CUTOVER enabled and handler exists', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const registry = createPublisherRegistry({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    process.env.DAEMON_ORCHESTRATION_P1_CUTOVER = '1';
    try {
      await registry.publish({ type: 'heartbeat', machineId: 'machine-1' });
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P1_CUTOVER;
    }

    expect(mutation).not.toHaveBeenCalled();
  });

  it('never routes harness.stream to convex', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const streamHub = createStreamHub();
    const received: string[] = [];
    streamHub.subscribe((event) => received.push(event.line));

    const registry = createPublisherRegistry({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      streamHub,
    });
    await registry.publish({
      type: 'harness.stream',
      harness: 'h1',
      stream: 'stdout',
      line: 'hello',
      timestamp: 1,
    });

    expect(mutation).not.toHaveBeenCalled();
    expect(received).toEqual(['hello']);
  });

  it('P5 on: appends to persistence and never calls direct Convex mutations', async () => {
    const store = createPersistenceStore(tempDbPath());
    const mutation = vi.fn().mockResolvedValue(undefined);
    process.env.DAEMON_ORCHESTRATION_P5 = '1';
    try {
      const registry = createPublisherRegistry({
        persistence: store,
        backend: { mutation, query: vi.fn() },
        sessionId: 'sess-1',
        machineId: 'machine-1',
      });

      await registry.publish({
        type: 'agent.start_failed',
        idempotencyKey: 'room-1:builder:start_failed',
        chatroomId: 'room-1',
        role: 'builder',
        machineId: 'machine-1',
        error: 'spawn failed',
        timestamp: 100,
      });

      expect(mutation).not.toHaveBeenCalled();
      const pending = store.listPendingOutbox();
      expect(pending).toHaveLength(1);
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P5;
      store.close();
    }
  });
});
