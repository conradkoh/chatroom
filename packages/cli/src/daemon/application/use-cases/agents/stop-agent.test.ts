import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stopAgent } from './stop-agent.js';
import {
  createAgentLifecyclePort,
  setAgentLifecyclePersistence,
} from '../../../infrastructure/agent-process-manager/agent-lifecycle-port.js';
import { createPersistenceStore } from '../../../infrastructure/persistence/index.js';
import { listPendingOutbox } from '../../../infrastructure/persistence/outbox.js';
import { getAgentReadModel } from '../../../infrastructure/persistence/read-models/agents.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p4-stop-agent-'));
  return join(dir, 'events.sqlite');
}

describe('stopAgent', () => {
  it('clears the agent read model on stop without a lifecycle event', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      setAgentLifecyclePersistence(store);
      stopAgent(
        { machineId: 'machine-1', lifecycle: createAgentLifecyclePort(), now: () => 3000 },
        { chatroomId: 'room-1', role: 'builder', pid: 1234 }
      );

      const agent = getAgentReadModel(store.db, 'machine-1', 'builder');
      expect(agent?.pid).toBeUndefined();
      expect(agent?.updatedAt).toBe(3000);
      expect(listPendingOutbox(store.db)).toHaveLength(0);
    } finally {
      setAgentLifecyclePersistence(undefined);
      store.close();
    }
  });

  it('appends a stop_timeout lifecycle event when the stop timed out', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      setAgentLifecyclePersistence(store);
      stopAgent(
        { machineId: 'machine-1', lifecycle: createAgentLifecyclePort(), now: () => 4000 },
        {
          chatroomId: 'room-1',
          role: 'planner',
          pid: 5678,
          stopTimedOut: true,
          durationMs: 30_000,
        }
      );

      const pending = listPendingOutbox(store.db);
      expect(pending).toHaveLength(1);
    } finally {
      setAgentLifecyclePersistence(undefined);
      store.close();
    }
  });
});
