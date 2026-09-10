// fallow-ignore-file unused-export
// Temporary: runtime wiring (Convex sender + daemon startup) lands in a later slice.
import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import {
  createKeyedFifoBatchedOutboxRegistry,
  type KeyedFifoBatchedOutboxRegistry,
} from './lib/keyed-fifo-batched-outbox-registry.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import type { AgentStoppedFact } from '../../services/agent-process-service/agent-stop-command/domain/entities/agent-fact.js';
import type { AgentFactSink } from '../../services/agent-process-service/agent-stop-command/service/ports/agent-fact-sink.js';

export const AGENT_COMMAND_FACT_OUTBOX_BATCH_SIZE = 1;

export type AgentCommandFactSendResult = {
  readonly success: true;
  readonly skipped?: boolean;
};

export type AgentCommandFactOutboxRegistry = KeyedFifoBatchedOutboxRegistry<
  AgentStoppedFact,
  AgentCommandFactSendResult
>;

export interface AgentCommandFactOutbox extends AgentFactSink {
  flushNow(key?: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function agentCommandFactDeliveryKey(machineId: string, fact: AgentStoppedFact): string {
  return [machineId, fact.chatroomId, fact.role.trim().toLowerCase()].join(':');
}

export function createAgentCommandFactOutboxRegistry(
  machineId: string,
  createSend: (key: string) => (fact: AgentStoppedFact) => Promise<AgentCommandFactSendResult>,
  options?: {
    readonly onError?: ((key: string, error: unknown) => void) | undefined;
  }
): AgentCommandFactOutboxRegistry {
  const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'agent-command-fact'));
  return createKeyedFifoBatchedOutboxRegistry({
    store,
    batchSize: AGENT_COMMAND_FACT_OUTBOX_BATCH_SIZE,
    createSend: (key) => async (facts) => {
      const results: AgentCommandFactSendResult[] = [];
      for (const fact of facts) results.push(await createSend(key)(fact));
      return results;
    },
    serialize: JSON.stringify,
    deserialize: (serialized) => JSON.parse(serialized) as AgentStoppedFact,
    retryDelayMs: 500,
    maxRetryDelayMs: 5 * 60_000,
    onError: options?.onError,
    classifyOutcome: () => ({ kind: 'success' }),
  });
}

function ignoreDeliveryOutcome(promise: Promise<AgentCommandFactSendResult>): void {
  promise.catch(() => undefined);
}

export function createAgentCommandFactOutbox(
  machineId: string,
  createSend: (key: string) => (fact: AgentStoppedFact) => Promise<AgentCommandFactSendResult>,
  options?: {
    readonly onError?: ((key: string, error: unknown) => void) | undefined;
  }
): AgentCommandFactOutbox {
  const registry = createAgentCommandFactOutboxRegistry(machineId, createSend, options);
  return {
    append: async (fact) => {
      // registry.enqueue synchronously persists before returning its promise.
      // Do not await eventual remote delivery from the AgentFactSink boundary.
      const delivery = registry.enqueue(agentCommandFactDeliveryKey(machineId, fact), fact);
      ignoreDeliveryOutcome(delivery);
    },
    flushNow: (key) => registry.flushNow(key),
    stopAll: () => registry.stopAll(),
  };
}
