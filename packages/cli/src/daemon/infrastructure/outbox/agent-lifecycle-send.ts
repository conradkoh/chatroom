import type { FunctionArgs } from 'convex/server';

import type { AgentLifecycleOutboxResult } from './agent-lifecycle-outbox.js';
import { api, type Id } from '../../../api.js';
import {
  normalizeAgentLifecycleFact,
  type AgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

type ProjectAgentLifecycleFactArgs = FunctionArgs<typeof api.machines.projectAgentLifecycleFact>;
type ConvexLifecycleFact = ProjectAgentLifecycleFactArgs['fact'];

/** Map CLI lifecycle facts to Convex mutation args (Id-branded fields at the boundary). */
function toConvexLifecycleFact(fact: AgentLifecycleFact): ConvexLifecycleFact {
  const normalized = normalizeAgentLifecycleFact(fact);
  if (normalized.kind === 'cleared_all_pids') return normalized;
  return {
    ...normalized,
    chatroomId: normalized.chatroomId as Id<'chatroom_rooms'>,
  };
}

export function createAgentLifecycleSend(
  session: Pick<DaemonSessionServiceShape, 'sessionId' | 'machineId' | 'backend'>
) {
  return async (fact: AgentLifecycleFact): Promise<AgentLifecycleOutboxResult> => {
    const args = {
      sessionId: session.sessionId as ProjectAgentLifecycleFactArgs['sessionId'],
      machineId: session.machineId,
      fact: toConvexLifecycleFact(fact),
    } satisfies ProjectAgentLifecycleFactArgs;
    return (await session.backend.mutation(
      api.machines.projectAgentLifecycleFact,
      args
    )) as AgentLifecycleOutboxResult;
  };
}
