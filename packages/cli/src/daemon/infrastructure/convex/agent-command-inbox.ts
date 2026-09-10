import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api, type Id } from '../../../api.js';
import type { AgentStopCommand } from '../../services/agent-command-service/domain/entities/agent-command.js';
import type { AgentCommandInbox } from '../../services/agent-command-service/service/ports/agent-command-inbox.js';

type RawClaim = NonNullable<FunctionReturnType<typeof api.daemon.agentCommandInbox.claimNext>>;

function toAgentStopCommand(claim: RawClaim): AgentStopCommand {
  const chatroomId = String(claim.chatroomId);
  return {
    commandId: String(claim.commandId),
    intentId: claim.intentId,
    machineId: claim.machineId,
    target:
      claim.scope.kind === 'agent'
        ? { kind: 'agent', chatroomId, role: claim.scope.role }
        : { kind: 'chatroom', chatroomId },
    ...(claim.targets === undefined ? {} : { targets: claim.targets }),
    reason: claim.reason,
    createdAt: claim.timestamp,
    deadlineAt: claim.deadline,
  };
}

export function createAgentCommandInbox(input: {
  readonly wsClient: ConvexClient;
  readonly backend: {
    mutation: (fn: unknown, args: unknown) => Promise<unknown>;
  };
  readonly sessionId: SessionId;
  readonly machineId: string;
}): AgentCommandInbox {
  const { wsClient, backend, sessionId, machineId } = input;
  return {
    claimNext: async () => {
      const claim = (await backend.mutation(api.daemon.agentCommandInbox.claimNext, {
        sessionId,
        machineId,
      })) as FunctionReturnType<typeof api.daemon.agentCommandInbox.claimNext>;
      if (claim === null) return null;
      return toAgentStopCommand(claim);
    },
    acknowledge: async (commandId: string) => {
      await backend.mutation(api.daemon.agentCommandInbox.acknowledge, {
        sessionId,
        commandId: commandId as Id<'chatroom_agentCommandInbox'>,
      });
    },
    renew: async (commandId: string) => {
      await backend.mutation(api.daemon.agentCommandInbox.renewClaim, {
        sessionId,
        commandId: commandId as Id<'chatroom_agentCommandInbox'>,
      });
    },
    subscribe: (onAvailable: () => void, onError?: (error: unknown) => void) => {
      const unsubscribe = wsClient.onUpdate(
        api.daemon.agentCommandInbox.watchNext,
        { sessionId, machineId },
        (result) => {
          if (result?.commandId) onAvailable();
        },
        (error) => {
          onError?.(error);
        }
      );
      return unsubscribe;
    },
  };
}
