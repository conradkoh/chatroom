/**
 * Shared helpers for machine assigned-task queries.
 */

import type {
  AssignedTaskAgentConfigView,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type CollectCtx = QueryCtx | MutationCtx;

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
export async function loadMachineAssignedTaskContext(
  ctx: QueryCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<
  | {
      machineId: string;
      agentConfigs: RemoteAgentConfig[];
      chatroomIds: Set<Id<'chatroom_rooms'>>;
      chatroomDocs: Map<string, { teamEntryPoint?: string | null; teamRoles?: string[] | null }>;
    }
  | undefined
> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine || machine.userId !== userId) {
    return undefined;
  }

  const agentConfigs = await loadRemoteAgentConfigsForMachine(ctx, machineId);
  if (!agentConfigs) {
    return undefined;
  }

  const chatroomIds = new Set(agentConfigs.map((c) => c.chatroomId));
  const chatroomDocs = new Map<
    string,
    { teamEntryPoint?: string | null; teamRoles?: string[] | null }
  >();

  for (const chatroomId of chatroomIds) {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    if (chatroom) {
      chatroomDocs.set(chatroomId, chatroom);
    }
  }

  return { machineId, agentConfigs, chatroomIds, chatroomDocs };
}

export function toAgentConfigView(
  config: RemoteAgentConfig,
  machineId: string
): AssignedTaskAgentConfigView {
  return {
    role: config.role,
    machineId: config.machineId ?? machineId,
    agentHarness: config.agentHarness ?? 'opencode',
    model: config.model,
    workingDir: config.workingDir,
    spawnedAgentPid: config.spawnedAgentPid,
    desiredState: config.desiredState,
    circuitState: config.circuitState,
  };
}

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

/** Client-side cursor filter — production subscribe uses indexed projection reads. */
// fallow-ignore-next-line unused-export
export function filterSignalsAfterKey(
  signals: AssignedTaskSignal[],
  afterKey: string | undefined,
  limit: number
): SubscribeAssignedTaskSignalsSlice {
  const sorted = [...signals].sort((a, b) =>
    a.revisionKey < b.revisionKey ? -1 : a.revisionKey > b.revisionKey ? 1 : 0
  );

  const filtered =
    afterKey === undefined || afterKey === ''
      ? sorted
      : sorted.filter((signal) => signal.revisionKey > afterKey);

  const items = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const lastItem = items.at(-1);
  const highKey = lastItem ? lastItem.revisionKey : null;

  return { items, highKey, hasMore };
}

export interface SubscribeAssignedTaskSignalsSlice {
  items: AssignedTaskSignal[];
  highKey: string | null;
  hasMore: boolean;
}
