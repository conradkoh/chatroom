import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPublisherRegistry } from './publisher-registry.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';

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

  it('no-ops when persistence is not provided', async () => {
    const registry = createPublisherRegistry();
    await expect(
      registry.publish({ type: 'heartbeat', machineId: 'm-1' })
    ).resolves.toBeUndefined();
  });
});
