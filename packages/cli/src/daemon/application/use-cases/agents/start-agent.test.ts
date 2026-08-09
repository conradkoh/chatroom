import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { startAgent } from './start-agent.js';
import {
  createAgentLifecyclePort,
  setAgentLifecyclePersistence,
} from '../../../infrastructure/agent-process-manager/agent-lifecycle-port.js';
import { createPersistenceStore } from '../../../infrastructure/persistence/index.js';
import { getAgentReadModel } from '../../../infrastructure/persistence/read-models/agents.js';
import { getParticipantReadModel } from '../../../infrastructure/persistence/read-models/participants.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p4-start-agent-'));
  return join(dir, 'events.sqlite');
}

describe('startAgent', () => {
  it('updates agent + participant read models synchronously', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      setAgentLifecyclePersistence(store);
      startAgent(
        { machineId: 'machine-1', lifecycle: createAgentLifecyclePort(), now: () => 2000 },
        { chatroomId: 'room-1', role: 'builder', pid: 1234, harnessSessionId: 'hs-1' }
      );

      const agent = getAgentReadModel(store.db, 'machine-1', 'builder');
      expect(agent?.pid).toBe(1234);
      expect(agent?.harnessSessionId).toBe('hs-1');
      expect(agent?.updatedAt).toBe(2000);

      const participant = getParticipantReadModel(store.db, 'room-1', 'builder');
      expect(participant?.turnPhase).toBe('agent.waiting');
      expect(participant?.lastSeenAt).toBe(2000);
    } finally {
      setAgentLifecyclePersistence(undefined);
      store.close();
    }
  });
});
