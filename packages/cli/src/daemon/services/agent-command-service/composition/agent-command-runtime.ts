// fallow-ignore-file unused-file
// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
import { createDaemonAgentCommandService } from './agent-command-service.js';
import type { AgentProcessManagerService } from '../../agent-process-service/index.js';
import {
  startAgentCommandInboxConsumer,
  type AgentCommandInboxConsumer,
  type AgentCommandInboxConsumerDependencies,
} from '../service/agent-command-inbox-consumer.js';
import type { AgentCommandInbox } from '../service/ports/agent-command-inbox.js';
import type { AgentFactSink } from '../service/ports/agent-fact-sink.js';

export interface AgentCommandRuntimeDependencies {
  readonly inbox: AgentCommandInbox;
  readonly processManager: AgentProcessManagerService;
  readonly factSink: AgentFactSink;
  readonly onError?: AgentCommandInboxConsumerDependencies['onError'];
  readonly leaseRenewalMs?: number;
  readonly now?: (() => number) | undefined;
}

export function startDaemonAgentCommandRuntime(
  deps: AgentCommandRuntimeDependencies
): AgentCommandInboxConsumer {
  const service = createDaemonAgentCommandService({
    processManager: deps.processManager,
    factSink: deps.factSink,
    now: deps.now,
  });
  return startAgentCommandInboxConsumer({
    inbox: deps.inbox,
    service,
    onError: deps.onError,
    leaseRenewalMs: deps.leaseRenewalMs,
  });
}
