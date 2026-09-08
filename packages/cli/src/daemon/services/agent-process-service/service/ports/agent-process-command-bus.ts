import type { AgentProcessManagerCommand } from '../agent-process-manager-service.js';

export interface AgentProcessCommandMessage {
  readonly body: AgentProcessManagerCommand;
  readonly messageId: string;
  readonly messageGroupId: string;
  readonly receiveCount: number;
}

export interface AgentProcessCommandBus {
  send(input: {
    body: AgentProcessManagerCommand;
    messageGroupId: string;
  }): Promise<void>;
  purge(input:
    | { readonly scope: 'all' }
    | { readonly scope: 'message-group-prefix'; readonly messageGroupPrefix: string }
  ): Promise<AgentProcessCommandMessage[]>;
  start(): void;
  stop(): Promise<void>;
}
