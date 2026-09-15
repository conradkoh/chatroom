import { describe, expect, it, vi } from 'vitest';

import { openDurableCoalescingStateStore } from './lib/durable-coalescing-state-store.js';
import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import { createWorkspaceFileTreeCheckpointOutboxRegistry } from './workspace-file-tree-checkpoint-outbox.js';
import { createWorkspaceFileTreeDeltaOutboxRegistry } from './workspace-file-tree-delta-outbox.js';

describe('file-tree outbox schema recovery', () => {
  it('skips an old checkpoint shape and delivers a valid replacement', async () => {
    const machineId = `test-checkpoint-schema-${Date.now()}-${Math.random()}`;
    const store = openDurableCoalescingStateStore(
      resolveOutboxDbPath(machineId, 'file-tree-checkpoint')
    );
    store.upsertPending('/workspace', JSON.stringify({ tree: {}, revision: 1 }));
    store.close();
    const send = vi.fn(async () => ({ revision: 2 }));
    const registry = createWorkspaceFileTreeCheckpointOutboxRegistry(machineId, () => send, {
      logger: { error: vi.fn() },
    });
    const delivery = registry.enqueueAndWait('/workspace', {
      tree: { entries: [], scannedAt: 1, rootDir: '/workspace' },
      revision: 2,
    });
    await registry.flushNow();
    await expect(delivery).resolves.toEqual({ revision: 2 });
    expect(send).toHaveBeenCalledOnce();
    await registry.stopAll();
  });

  it('skips an old delta shape and still returns the successor backend revision', async () => {
    const machineId = `test-delta-schema-${Date.now()}-${Math.random()}`;
    const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'file-tree-delta'));
    store.enqueue('/workspace', JSON.stringify({ delta: {}, baseRevision: 1 }));
    store.close();
    const send = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));
    const registry = createWorkspaceFileTreeDeltaOutboxRegistry(machineId, () => send, {
      logger: { error: vi.fn() },
    });
    const delivery = registry.enqueueAndWait('/workspace', {
      baseRevision: 1,
      delta: { operationId: 'delta-2', added: [], removed: [], typeChanged: [], createdAt: 1 },
    });
    await registry.flushNow();
    await expect(delivery).resolves.toEqual({ status: 'applied', revision: 2 });
    expect(send).toHaveBeenCalledOnce();
    await registry.stopAll();
  });
});
