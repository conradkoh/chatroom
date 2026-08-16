/**
 * Write-time projection sync for machine assigned-task snapshots.
 */

import type { AssignedTaskPresenceDelta } from './assigned-task-monitor-contract';
import {
  getParticipantForChatroomRole,
  loadRemoteAgentConfigsForMachine,
  toParticipantView,
} from './assigned-tasks-core';
import {
  buildAssignedTaskPresenceKey,
  buildAssignedTaskRevisionKey,
  primaryAssignedTaskSignalType,
} from './assigned-tasks-revision';
import type { AssignedTaskSignal } from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';
import { getTeamEntryPoint } from '../../entities/team';
import { resolveSessionAugmentationForTask } from '../../handoff/parse-session-augmentation';

type RemoteAgentConfig = Doc<'chatroom_teamAgentConfigs'>;
type SnapshotDoc = Doc<'chatroom_machineAssignedTaskSnapshots'>;
type ActiveTaskStatus = SnapshotDoc['taskStatus'];

const ACTIVE_TASK_STATUSES: ActiveTaskStatus[] = ['pending', 'acknowledged', 'in_progress'];

type CollectCtx = QueryCtx | MutationCtx;

async function collectActiveTasksForChatroom(
  ctx: CollectCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_tasks'>[]> {
  const tasks: Doc<'chatroom_tasks'>[] = [];
  for (const status of ACTIVE_TASK_STATUSES) {
    const rows = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId).eq('status', status))
      .collect();
    tasks.push(...rows);
  }
  return tasks;
}

function configsForRole(configs: RemoteAgentConfig[], role: string): RemoteAgentConfig[] {
  const target = role.toLowerCase();
  return configs.filter((config) => config.role.toLowerCase() === target);
}

// fallow-ignore-next-line complexity
function resolveResponsibleConfigs(
  task: Doc<'chatroom_tasks'>,
  configsForChatroom: RemoteAgentConfig[],
  chatroom: { teamEntryPoint?: string | null; teamRoles?: string[] | null } | undefined
): RemoteAgentConfig[] {
  const assignedRole =
    task.assignedTo && task.assignedTo.toLowerCase() !== 'user'
      ? task.assignedTo
      : getTeamEntryPoint(chatroom ?? {});
  if (assignedRole) {
    return configsForRole(configsForChatroom, assignedRole);
  }
  return configsForChatroom.slice(0, 1);
}

export function snapshotDocToSignal(doc: SnapshotDoc): AssignedTaskSignal {
  return {
    taskId: doc.taskId,
    chatroomId: doc.chatroomId,
    role: doc.role,
    status: doc.taskStatus,
    signalType: primaryAssignedTaskSignalType(doc.taskUpdatedAt, doc.configUpdatedAt),
    revisionKey: doc.revisionKey,
    sessionAugmentation: doc.sessionAugmentation,
    lastSeenAction: doc.lastSeenAction ?? null,
    lastStatus: doc.lastStatus ?? null,
    spawnedAgentPid: doc.spawnedAgentPid,
    desiredState: doc.desiredState as 'running' | 'stopped' | undefined,
    machineId: doc.machineId,
    agentHarness: doc.agentHarness,
    workingDir: doc.workingDir,
    assignedTo: doc.taskAssignedTo,
    createdAt: doc.taskCreatedAt,
  };
}

export function snapshotDocToPresenceDelta(doc: SnapshotDoc): AssignedTaskPresenceDelta {
  return { taskId: doc.taskId, role: doc.role, presenceKey: doc.presenceKey };
}

interface SnapshotRowInput {
  machineId: string;
  task: Doc<'chatroom_tasks'>;
  config: RemoteAgentConfig;
  participant: Doc<'chatroom_participants'> | null;
  now: number;
  presenceOnly?: boolean;
  existing?: SnapshotDoc | null;
}

// fallow-ignore-next-line complexity
function buildSnapshotFields(input: SnapshotRowInput): Omit<SnapshotDoc, '_id' | '_creationTime'> {
  const { task, config, participant, machineId, now, existing, presenceOnly } = input;
  const taskUpdatedAt = task.updatedAt ?? task.createdAt ?? now;
  const configUpdatedAt = config.updatedAt;
  const participantView = toParticipantView(participant) ?? {
    lastSeenAction: null,
    lastSeenAt: null,
    lastStatus: null,
  };
  const revisionKey = buildAssignedTaskRevisionKey({
    taskUpdatedAt,
    configUpdatedAt,
    lastSeenAction: participantView.lastSeenAction ?? '',
    lastStatus: participantView.lastStatus ?? '',
    taskId: task._id,
    role: config.role,
  });

  const presenceUpdatedAt =
    presenceOnly && existing
      ? now
      : (participant?.lastSeenAt ?? existing?.presenceUpdatedAt ?? now);
  const presenceKey = buildAssignedTaskPresenceKey({
    presenceUpdatedAt,
    taskId: task._id,
    role: config.role,
  });

  const signalUpdatedAt =
    existing && existing.revisionKey === revisionKey
      ? existing.signalUpdatedAt
      : Math.max(taskUpdatedAt, configUpdatedAt, now);

  return {
    machineId,
    taskId: task._id,
    chatroomId: task.chatroomId,
    role: config.role,
    taskStatus: task.status as ActiveTaskStatus,
    taskAssignedTo: task.assignedTo,
    taskCreatedAt: task.createdAt ?? now,
    taskUpdatedAt,
    sessionAugmentation: resolveSessionAugmentationForTask({ content: task.content, startInNewSession: task.startInNewSession }, config.role),
    agentHarness: config.agentHarness ?? 'opencode',
    model: config.model,
    workingDir: config.workingDir,
    spawnedAgentPid: config.spawnedAgentPid,
    desiredState: config.desiredState,
    circuitState: config.circuitState,
    configUpdatedAt,
    lastSeenAt: participantView.lastSeenAt ?? undefined,
    lastSeenAction: participantView.lastSeenAction ?? undefined,
    lastStatus: participantView.lastStatus ?? undefined,
    presenceUpdatedAt,
    presenceKey,
    revisionKey,
    signalUpdatedAt,
  };
}

async function findSnapshotDoc(
  ctx: MutationCtx,
  machineId: string,
  taskId: Id<'chatroom_tasks'>,
  role: string
): Promise<SnapshotDoc | null> {
  return (
    (await ctx.db
      .query('chatroom_machineAssignedTaskSnapshots')
      .withIndex('by_machineId_taskId_role', (q) =>
        q.eq('machineId', machineId).eq('taskId', taskId).eq('role', role)
      )
      .unique()) ?? null
  );
}

async function upsertSnapshotRow(ctx: MutationCtx, input: SnapshotRowInput): Promise<void> {
  if (!input.config.machineId) return;
  const machineId = input.config.machineId;
  const existing = await findSnapshotDoc(ctx, machineId, input.task._id, input.config.role);
  const fields = buildSnapshotFields({ ...input, machineId, existing });

  if (existing) {
    await ctx.db.patch('chatroom_machineAssignedTaskSnapshots', existing._id, fields);
    return;
  }
  await ctx.db.insert('chatroom_machineAssignedTaskSnapshots', fields);
}

async function deleteSnapshotsForTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<void> {
  const rows = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete('chatroom_machineAssignedTaskSnapshots', row._id);
  }
}

async function deleteSnapshotsForMachine(ctx: MutationCtx, machineId: string): Promise<void> {
  const rows = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete('chatroom_machineAssignedTaskSnapshots', row._id);
  }
}

/** Rebuild projection rows for one machine (daemon startup / backfill). */
// fallow-ignore-next-line complexity
export async function projectAssignedTaskSnapshotsForMachine(
  ctx: MutationCtx,
  machineId: string
): Promise<void> {
  const agentConfigs = await loadRemoteAgentConfigsForMachine(ctx, machineId);
  if (!agentConfigs) {
    await deleteSnapshotsForMachine(ctx, machineId);
    return;
  }

  const chatroomIds = new Set(agentConfigs.map((c) => c.chatroomId));
  const now = Date.now();
  const desiredKeys = new Set<string>();

  for (const chatroomId of chatroomIds) {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    const activeTasks = await collectActiveTasksForChatroom(ctx, chatroomId);
    const configsForChatroom = filterTeamAgentConfigsForTeam(
      agentConfigs.filter((c) => c.chatroomId === chatroomId),
      chatroomId,
      chatroom?.teamId
    );

    for (const task of activeTasks) {
      const responsibleConfigs = resolveResponsibleConfigs(
        task,
        configsForChatroom,
        chatroom ?? {}
      );
      for (const config of responsibleConfigs) {
        const configMachineId = config.machineId;
        if (!configMachineId) continue;
        const participant = await getParticipantForChatroomRole(ctx, chatroomId, config.role);
        desiredKeys.add(`${configMachineId}:${task._id}:${config.role}`);
        await upsertSnapshotRow(ctx, {
          machineId: configMachineId,
          task,
          config,
          participant,
          now,
        });
      }
    }
  }

  const existing = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  for (const row of existing) {
    const key = `${row.machineId}:${row.taskId}:${row.role}`;
    if (!desiredKeys.has(key)) {
      await ctx.db.delete('chatroom_machineAssignedTaskSnapshots', row._id);
    }
  }
}

/** Rebuild assigned-task snapshot projection for all machines in a chatroom. */
export async function projectAssignedTaskSnapshotsForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const configs = filterTeamAgentConfigsForTeam(
    await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) => q.eq(q.field('type'), 'remote'))
      .collect(),
    chatroomId,
    chatroom?.teamId
  );

  const machineIds = new Set(
    configs.map((c) => c.machineId).filter((id): id is string => id !== undefined)
  );
  for (const machineId of machineIds) {
    await projectAssignedTaskSnapshotsForMachine(ctx, machineId);
  }
}

function snapshotParticipantFields(doc: Doc<'chatroom_machineAssignedTaskSnapshots'>) {
  return {
    lastSeenAt: doc.lastSeenAt ?? undefined,
    lastSeenAction: doc.lastSeenAction ?? undefined,
    lastStatus: doc.lastStatus ?? undefined,
  };
}

// fallow-ignore-next-line complexity
function participantFieldsFromDoc(
  participant: Doc<'chatroom_participants'> | null
): ReturnType<typeof snapshotParticipantFields> {
  return {
    lastSeenAt: participant?.lastSeenAt ?? undefined,
    lastSeenAction: participant?.lastSeenAction ?? undefined,
    lastStatus: participant?.lastStatus ?? undefined,
  };
}

function participantFieldsEqual(
  row: Doc<'chatroom_machineAssignedTaskSnapshots'>,
  participant: Doc<'chatroom_participants'> | null
): boolean {
  const a = snapshotParticipantFields(row);
  const b = participantFieldsFromDoc(participant);
  return (
    a.lastSeenAt === b.lastSeenAt &&
    a.lastSeenAction === b.lastSeenAction &&
    a.lastStatus === b.lastStatus
  );
}

/** Pick one row per heartbeat for presenceKey bump (daemon only needs one trigger). */
// fallow-ignore-next-line complexity
function pickPresenceCanonicalRow(
  rows: Doc<'chatroom_machineAssignedTaskSnapshots'>[],
  participant: Doc<'chatroom_participants'> | null
): Doc<'chatroom_machineAssignedTaskSnapshots'> | undefined {
  if (rows.length === 0) return undefined;
  const inFlightId = participant?.lastInFlightTaskId;
  if (inFlightId) {
    const match = rows.find((r) => r.taskId === inFlightId);
    if (match) return match;
  }
  for (const status of ['in_progress', 'acknowledged', 'pending'] as const) {
    const match = rows.find((r) => r.taskStatus === status);
    if (match) return match;
  }
  return rows[0];
}

/** After task status leaves active set, drop snapshot rows. */
export async function projectAssignedTaskSnapshotsAfterTaskChange(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<void> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    await deleteSnapshotsForTask(ctx, taskId);
    return;
  }
  if (!ACTIVE_TASK_STATUSES.includes(task.status as ActiveTaskStatus)) {
    await deleteSnapshotsForTask(ctx, taskId);
    return;
  }
  await projectAssignedTaskSnapshotsForChatroom(ctx, task.chatroomId);
}

// fallow-ignore-next-line complexity
async function patchSnapshotRowPresence(
  ctx: MutationCtx,
  row: Doc<'chatroom_machineAssignedTaskSnapshots'>,
  participant: Doc<'chatroom_participants'> | null,
  now: number,
  bumpSignal: boolean,
  bumpPresenceKey: boolean
): Promise<void> {
  if (!bumpSignal && participantFieldsEqual(row, participant)) {
    return;
  }

  const fields = participantFieldsFromDoc(participant);
  const revisionKey = buildAssignedTaskRevisionKey({
    taskUpdatedAt: row.taskUpdatedAt,
    configUpdatedAt: row.configUpdatedAt,
    lastSeenAction: fields.lastSeenAction ?? '',
    lastStatus: fields.lastStatus ?? '',
    taskId: row.taskId,
    role: row.role,
  });

  const presencePatch = bumpPresenceKey
    ? {
        presenceUpdatedAt: now,
        presenceKey: buildAssignedTaskPresenceKey({
          presenceUpdatedAt: now,
          taskId: row.taskId,
          role: row.role,
        }),
      }
    : {};

  const patch = {
    lastSeenAt: fields.lastSeenAt,
    lastSeenAction: fields.lastSeenAction,
    lastStatus: fields.lastStatus,
    revisionKey,
    ...presencePatch,
  };

  if (revisionKey !== row.revisionKey || bumpSignal) {
    await ctx.db.patch('chatroom_machineAssignedTaskSnapshots', row._id, {
      ...patch,
      signalUpdatedAt: now,
    });
    return;
  }

  await ctx.db.patch('chatroom_machineAssignedTaskSnapshots', row._id, patch);
}

/** Patch presence fields on snapshot rows for a participant check-in. */
// fallow-ignore-next-line complexity
export async function syncParticipantPresenceOnSnapshots(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  options?: { actionChanged?: boolean }
): Promise<void> {
  const participant = await getParticipantForChatroomRole(ctx, chatroomId, role);

  const rows = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_chatroomId_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .collect();

  const now = Date.now();
  const bumpSignal = options?.actionChanged ?? false;
  const canonical = pickPresenceCanonicalRow(rows, participant);

  for (const row of rows) {
    const bumpPresenceKey = canonical !== undefined && row._id === canonical._id;
    await patchSnapshotRowPresence(ctx, row, participant, now, bumpSignal, bumpPresenceKey);
  }
}

export async function assertMachineSnapshotAccess(
  ctx: QueryCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<boolean> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return machine !== null && machine.userId === userId;
}
