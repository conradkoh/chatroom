/**
 * Shared row collection for machine assigned-task queries.
 */

import type {
  AssignedTaskAgentConfigView,
  AssignedTaskSnapshotView,
  AssignedTaskSignal,
  AssignedTaskSignalType,
  AssignedTaskView,
  MachineAssignedTasksInput,
} from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { getTeamEntryPoint } from '../../entities/team';
import { parseSessionAugmentation } from '../../handoff/parse-session-augmentation';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;

export interface CollectedAssignedTaskRow {
  task: Doc<'chatroom_tasks'>;
  config: RemoteAgentConfig;
  participant: Doc<'chatroom_participants'> | null;
  configUpdatedAt: number;
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

  const agentConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .filter((q) => q.eq(q.field('type'), 'remote'))
    .collect();

  if (agentConfigs.length === 0) {
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

export async function mapAssignedTasksForMachine<T>(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput,
  mapRow: (row: CollectedAssignedTaskRow, machineId: string) => T
): Promise<{ tasks: T[] }> {
  const context = await loadMachineAssignedTaskContext(ctx, input.machineId, input.userId);
  if (!context) {
    return { tasks: [] };
  }

  const rows = await collectAssignedTaskRows(ctx, context);
  return {
    tasks: rows.map((row) => mapRow(row, input.machineId)),
  };
}

// fallow-ignore-next-line complexity
export async function collectAssignedTaskRows(
  ctx: QueryCtx,
  context: NonNullable<Awaited<ReturnType<typeof loadMachineAssignedTaskContext>>>
): Promise<CollectedAssignedTaskRow[]> {
  const rows: CollectedAssignedTaskRow[] = [];

  for (const chatroomId of context.chatroomIds) {
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'acknowledged'),
          q.eq(q.field('status'), 'in_progress')
        )
      )
      .collect();

    const configsForChatroom = context.agentConfigs.filter((c) => c.chatroomId === chatroomId);

    for (const task of activeTasks) {
      let responsibleConfigs: typeof configsForChatroom;

      if (task.assignedTo && task.assignedTo.toLowerCase() !== 'user') {
        const assignedTo = task.assignedTo;
        responsibleConfigs = configsForChatroom.filter(
          (c) => c.role.toLowerCase() === assignedTo.toLowerCase()
        );
      } else {
        const chatroom = context.chatroomDocs.get(chatroomId);
        const entryPoint = getTeamEntryPoint(chatroom ?? {});
        if (entryPoint) {
          responsibleConfigs = configsForChatroom.filter(
            (c) => c.role.toLowerCase() === entryPoint.toLowerCase()
          );
        } else {
          responsibleConfigs = configsForChatroom.slice(0, 1);
        }
      }

      for (const config of responsibleConfigs) {
        const participant = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', config.role)
          )
          .unique();

        rows.push({
          task,
          config,
          participant: participant ?? null,
          configUpdatedAt: config.updatedAt,
        });
      }
    }
  }

  return rows;
}

function toAgentConfigView(
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
function toParticipantView(
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

export function rowToSnapshotView(
  row: CollectedAssignedTaskRow,
  machineId: string
): AssignedTaskSnapshotView {
  const { task, config, participant } = row;
  return {
    taskId: task._id,
    chatroomId: task.chatroomId,
    status: task.status,
    assignedTo: task.assignedTo,
    updatedAt: task.updatedAt ?? task.createdAt ?? Date.now(),
    createdAt: task.createdAt ?? Date.now(),
    agentConfig: toAgentConfigView(config, machineId),
    participant: toParticipantView(participant),
  };
}

export function rowToFullView(row: CollectedAssignedTaskRow, machineId: string): AssignedTaskView {
  return {
    ...rowToSnapshotView(row, machineId),
    taskContent: row.task.content,
  };
}

/** Build a sortable revision key — excludes participant lastSeenAt-only heartbeats. */
// fallow-ignore-next-line complexity
function buildAssignedTaskRevisionKey(row: CollectedAssignedTaskRow): string {
  const taskUpdatedAt = row.task.updatedAt ?? row.task.createdAt ?? 0;
  const action = row.participant?.lastSeenAction ?? '';
  const status = row.participant?.lastStatus ?? '';
  const paddedTask = String(taskUpdatedAt).padStart(16, '0');
  const paddedConfig = String(row.configUpdatedAt).padStart(16, '0');
  return `${paddedTask}:${paddedConfig}:${action}:${status}:${row.task._id}:${row.config.role}`;
}

function primarySignalType(row: CollectedAssignedTaskRow): AssignedTaskSignalType {
  const taskUpdatedAt = row.task.updatedAt ?? row.task.createdAt ?? 0;
  if (taskUpdatedAt >= row.configUpdatedAt) {
    return 'task';
  }
  return 'agent_config';
}

// fallow-ignore-next-line complexity
export function rowToSignal(row: CollectedAssignedTaskRow): AssignedTaskSignal | undefined {
  const status = row.task.status;
  if (status !== 'pending' && status !== 'acknowledged' && status !== 'in_progress') {
    return undefined;
  }

  return {
    taskId: row.task._id,
    chatroomId: row.task.chatroomId,
    role: row.config.role,
    status,
    signalType: primarySignalType(row),
    revisionKey: buildAssignedTaskRevisionKey(row),
    sessionAugmentation: parseSessionAugmentation(row.task.content),
    lastSeenAction: row.participant?.lastSeenAction ?? null,
    spawnedAgentPid: row.config.spawnedAgentPid,
    desiredState: row.config.desiredState,
  };
}

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
