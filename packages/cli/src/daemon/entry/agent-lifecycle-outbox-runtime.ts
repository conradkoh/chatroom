import type { SessionId } from './daemon-types.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import {
  agentLifecycleKey,
  createAgentLifecycleOutboxRegistry,
  type AgentLifecycleOutboxRegistry,
} from '../infrastructure/outbox/agent-lifecycle-outbox.js';
import { createAgentLifecycleSend } from '../infrastructure/outbox/agent-lifecycle-send.js';

export function createAgentLifecycleOutboxForSession(args: {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
}): AgentLifecycleOutboxRegistry {
  return createAgentLifecycleOutboxRegistry(args.machineId, () =>
    createAgentLifecycleSend({
      sessionId: args.sessionId,
      machineId: args.machineId,
      backend: args.backend,
    } as never)
  );
}
export function enqueueAgentLifecycleFact(
  registry: AgentLifecycleOutboxRegistry,
  machineId: string,
  fact: AgentLifecycleFact
) {
  return registry.enqueue(agentLifecycleKey(machineId, fact), fact);
}
