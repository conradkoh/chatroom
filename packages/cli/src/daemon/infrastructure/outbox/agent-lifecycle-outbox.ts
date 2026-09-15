import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import {
  createKeyedFifoBatchedOutboxRegistry,
  type KeyedFifoBatchedOutboxRegistry,
} from './lib/keyed-fifo-batched-outbox-registry.js';
import { isOutboxArgumentValidationError, type OutboxErrorLogger } from './lib/outbox-failure.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import {
  agentLifecycleDeliveryKey,
  normalizeAgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';

export const AGENT_LIFECYCLE_OUTBOX_BATCH_SIZE = 1;
/** Durable local acknowledgement, not confirmation of backend delivery. */
export type AgentLifecycleOutboxResult = { success: true };
export type AgentLifecycleDeliveryResult = {
  success: true;
  skipped?: boolean | undefined;
  clearedCount?: number | undefined;
};
export type AgentLifecycleOutboxRegistry = Omit<
  KeyedFifoBatchedOutboxRegistry<AgentLifecycleFact, AgentLifecycleDeliveryResult>,
  'enqueue'
> & {
  enqueue(key: string, fact: AgentLifecycleFact): Promise<AgentLifecycleOutboxResult>;
};

export function createAgentLifecycleOutboxRegistry(
  machineId: string,
  createSend: (key: string) => (fact: AgentLifecycleFact) => Promise<AgentLifecycleDeliveryResult>,
  options?: {
    onError?: ((key: string, error: unknown) => void) | undefined;
    logger?: OutboxErrorLogger | undefined;
  }
): AgentLifecycleOutboxRegistry {
  const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-lifecycle'));
  const registry = createKeyedFifoBatchedOutboxRegistry({
    store,
    batchSize: AGENT_LIFECYCLE_OUTBOX_BATCH_SIZE,
    createSend: (key) => async (facts) => {
      const results: AgentLifecycleDeliveryResult[] = [];
      for (const fact of facts) results.push(await createSend(key)(fact));
      return results;
    },
    serialize: JSON.stringify,
    deserialize: (serialized) => normalizeAgentLifecycleFact(JSON.parse(serialized)),
    retryDelayMs: 500,
    maxRetryDelayMs: 5 * 60_000,
    onError: options?.onError,
    logger: options?.logger,
    isPermanentError: isOutboxArgumentValidationError,
    classifyOutcome: () => ({ kind: 'success' }),
  });
  return {
    ...registry,
    enqueue: async (key, fact) => {
      await registry.enqueue(key, fact);
      return { success: true };
    },
  };
}

export function agentLifecycleKey(machineId: string, fact: AgentLifecycleFact): string {
  return agentLifecycleDeliveryKey(machineId, fact);
}
