import type { FunctionArgs } from 'convex/server';

import type { AgentLifecycleOutboxResult } from './agent-lifecycle-outbox.js';
import { api, type Id } from '../../../api.js';
import {
  normalizeAgentLifecycleFact,
  type AgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

type ProjectAgentLifecycleFactArgs = FunctionArgs<typeof api.machines.projectAgentLifecycleFact>;
type RecordAgentActivityHeartbeatArgs = FunctionArgs<
  typeof api.machines.recordAgentActivityHeartbeat
>;
type ConvexLifecycleFact = ProjectAgentLifecycleFactArgs['fact'];

/** Map CLI lifecycle facts to Convex mutation args (Id-branded fields at the boundary). */
function toConvexLifecycleFact(fact: AgentLifecycleFact): ConvexLifecycleFact {
  const normalized = normalizeAgentLifecycleFact(fact);
  if (normalized.kind === 'cleared_all_pids') return normalized;
  return {
    ...normalized,
    chatroomId: normalized.chatroomId as Id<'chatroom_rooms'>,
    ...(normalized.kind === 'chatroom_shutdown_complete'
      ? { commandId: normalized.commandId as Id<'chatroomWorkspaceAgentCommandsInbox'> }
      : {}),
    ...((normalized.kind === 'activity' || normalized.kind === 'turn_failed') && normalized.taskId
      ? { taskId: normalized.taskId as Id<'chatroom_tasks'> }
      : {}),
  } as ConvexLifecycleFact;
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
    const result = (await session.backend.mutation(
      fact.kind === 'activity'
        ? api.machines.recordAgentActivityHeartbeat
        : api.machines.projectAgentLifecycleFact,
      args as ProjectAgentLifecycleFactArgs & RecordAgentActivityHeartbeatArgs
    )) as AgentLifecycleOutboxResult;
    return result;
  };
}
