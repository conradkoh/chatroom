import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import {
  createKeyedFifoBatchedOutboxRegistry,
  type KeyedFifoBatchedOutboxRegistry,
} from './lib/keyed-fifo-batched-outbox-registry.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import {
  agentLifecycleDeliveryKey,
  normalizeAgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';

export const AGENT_LIFECYCLE_OUTBOX_BATCH_SIZE = 1;
export type AgentLifecycleOutboxResult = {
  success: true;
  skipped?: boolean | undefined;
  clearedCount?: number | undefined;
  rejectionReason?: string | undefined;
};
export type AgentLifecycleOutboxRegistry = KeyedFifoBatchedOutboxRegistry<
  AgentLifecycleFact,
  AgentLifecycleOutboxResult
>;

export function createAgentLifecycleOutboxRegistry(
  machineId: string,
  createSend: (key: string) => (fact: AgentLifecycleFact) => Promise<AgentLifecycleOutboxResult>,
  options?: { onError?:( (key: string, error: unknown) => void) | undefined }
): AgentLifecycleOutboxRegistry {
  const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
  return createKeyedFifoBatchedOutboxRegistry({
    store,
    batchSize: AGENT_LIFECYCLE_OUTBOX_BATCH_SIZE,
    createSend: (key) => async (facts) => {
      const results: AgentLifecycleOutboxResult[] = [];
      for (const fact of facts) results.push(await createSend(key)(fact));
      return results;
    },
    serialize: JSON.stringify,
    deserialize: (serialized) => normalizeAgentLifecycleFact(JSON.parse(serialized)),
    retryDelayMs: 500,
    maxRetryDelayMs: 5 * 60_000,
    onError: options?.onError,
    classifyOutcome: () => ({ kind: 'success' }),
  });
}

export function agentLifecycleKey(machineId: string, fact: AgentLifecycleFact): string {
  return agentLifecycleDeliveryKey(machineId, fact);
}
