// fallow-ignore-file unused-file
import type { AgentLifecyclePort } from '../../application/ports/agent-lifecycle.port.js';
import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import type { PersistenceStore } from '../persistence/index.js';
import { upsertAgentReadModel } from '../persistence/read-models/agents.js';
import { upsertParticipantReadModel } from '../persistence/read-models/participants.js';

/**
 * Module-level persistence wiring for the APM lifecycle port.
 * The daemon wires the SQLite store after `initDaemon()` (which constructs the
 * AgentProcessManager) — the port reads the reference lazily at call time.
 */
let persistenceStore: PersistenceStore | undefined;

export function setAgentLifecyclePersistence(store: PersistenceStore | undefined): void {
  persistenceStore = store;
}

function requireStore(): PersistenceStore {
  if (!persistenceStore) {
    throw new Error('AgentLifecyclePort persistence not wired — setAgentLifecyclePersistence()');
  }
  return persistenceStore;
}

export function createAgentLifecyclePort(): AgentLifecyclePort {
  return {
    appendLifecycleEvent(event: OutboundEvent): void {
      requireStore().append(event);
    },
    updateAgentReadModel(row): void {
      upsertAgentReadModel(requireStore().db, row);
    },
    updateParticipantReadModel(row): void {
      upsertParticipantReadModel(requireStore().db, row);
    },
  };
}
