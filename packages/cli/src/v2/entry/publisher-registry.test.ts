import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

  it('no-ops when persistence is not provided', async () => {
    const registry = createPublisherRegistry();
    await expect(
      registry.publish({ type: 'heartbeat', machineId: 'm-1' })
    ).resolves.toBeUndefined();
  });
});
