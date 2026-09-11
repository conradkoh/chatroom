/**
 * Shared helpers for machine assigned-task queries.
 */

import type { AssignedTaskSnapshotView } from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type CollectCtx = QueryCtx | MutationCtx;

// fallow-ignore-next-line unused-export
export async function loadRemoteAgentConfigsForMachine(
  ctx: CollectCtx,
  machineId: string
): Promise<RemoteAgentConfig[] | undefined> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    return undefined;
  }

  const agentConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .filter((q) => q.eq(q.field('type'), 'remote'))
    .collect();

  if (agentConfigs.length === 0) {
    return undefined;
  }

  return agentConfigs;
}

export async function getParticipantForChatroomRole(
  ctx: CollectCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<Doc<'chatroom_participants'> | null> {
  return (
    (await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique()) ?? null
  );
}

// fallow-ignore-next-line complexity
/** @deprecated Legacy snapshot mapping only; new projections omit participant presence. */
// fallow-ignore-next-line complexity
export function toParticipantView(
  participant: Doc<'chatroom_participants'> | null
): AssignedTaskSnapshotView['participant'] {
  if (!participant) {
    return {
      lastSeenAction: null,
      lastSeenAt: null,
      lastStatus: null,
    };
  }
  return {
    lastSeenAction: participant.lastSeenAction ?? null,
    lastSeenAt: participant.lastSeenAt ?? null,
    lastStatus: participant.lastStatus ?? null,
  };
}
