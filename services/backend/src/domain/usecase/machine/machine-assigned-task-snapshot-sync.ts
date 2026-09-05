/**
 * Write-time projection sync for machine assigned-task snapshots.
 */

import { loadRemoteAgentConfigsForMachine } from './assigned-tasks-core';
import {
  buildAssignedTaskPresenceKey,
  buildAssignedTaskRevisionKey,
  primaryAssignedTaskSignalType,
} from './assigned-tasks-revision';
import type { AssignedTaskSignal } from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
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
  chatroom:
    | { teamEntryPoint?: string | null | undefined; teamRoles?: string[] | null | undefined }
    | undefined
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

// fallow-ignore-next-line unused-export
export function snapshotDocToSignal(doc: SnapshotDoc): AssignedTaskSignal {
  return omitUndefined({
    taskId: doc.taskId,
    chatroomId: doc.chatroomId,
    role: doc.role,
    status: doc.taskStatus,
    signalType: primaryAssignedTaskSignalType(doc.taskUpdatedAt, doc.configUpdatedAt),
    revisionKey: doc.revisionKey,
    sessionAugmentation: doc.sessionAugmentation,
    machineId: doc.machineId,
    agentHarness: doc.agentHarness,
    workingDir: doc.workingDir,
    assignedTo: doc.taskAssignedTo,
    createdAt: doc.taskCreatedAt,
  });
}

interface SnapshotRowInput {
  machineId: string;
  task: Doc<'chatroom_tasks'>;
  config: RemoteAgentConfig;
  now: number;
  existing?: SnapshotDoc | null | undefined;
}

// fallow-ignore-next-line complexity
function buildSnapshotFields(input: SnapshotRowInput): Omit<SnapshotDoc, '_id' | '_creationTime'> {
  const { task, config, machineId, now, existing } = input;
  const taskUpdatedAt = task.updatedAt ?? task.createdAt ?? now;
  const configUpdatedAt = config.updatedAt;
  const revisionKey = buildAssignedTaskRevisionKey({
    taskUpdatedAt,
    configUpdatedAt,
    taskId: task._id,
    role: config.role,
  });

  const presenceUpdatedAt = taskUpdatedAt;
  const presenceKey = buildAssignedTaskPresenceKey({
    presenceUpdatedAt,
    taskId: task._id,
    role: config.role,
  });

  const signalUpdatedAt =
    existing && existing.revisionKey === revisionKey
      ? existing.signalUpdatedAt
      : Math.max(taskUpdatedAt, configUpdatedAt, now);

  return omitUndefined({
    machineId,
    taskId: task._id,
    chatroomId: task.chatroomId,
    role: config.role,
    taskStatus: task.status as ActiveTaskStatus,
    taskAssignedTo: task.assignedTo,
    taskCreatedAt: task.createdAt ?? now,
    taskUpdatedAt,
    sessionAugmentation: resolveSessionAugmentationForTask(
      {
        content: task.content,
        taskEnvelope: task.taskEnvelope,
        startInNewSession: task.startInNewSession,
      },
      config.role
    ),
    agentHarness: config.agentHarness ?? 'opencode',
    model: config.model,
    workingDir: config.workingDir,
    configUpdatedAt,
    presenceUpdatedAt,
    presenceKey,
    revisionKey,
    signalUpdatedAt,
    configLifecycleRevision: config.lifecycleRevision ?? 0,
  });
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
        desiredKeys.add(`${configMachineId}:${task._id}:${config.role}`);
        await upsertSnapshotRow(ctx, {
          machineId: configMachineId,
          task,
          config,
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
async function loadRemoteConfigsForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ chatroom: Doc<'chatroom_rooms'> | null; configs: RemoteAgentConfig[] }> {
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
  return { chatroom, configs };
}

async function listSnapshotRowsForChatroomRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  return ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_chatroomId_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .collect();
}

export async function projectAssignedTaskSnapshotsForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const { configs } = await loadRemoteConfigsForChatroom(ctx, chatroomId);

  const machineIds = new Set(
    configs.map((c) => c.machineId).filter((id): id is string => id !== undefined)
  );
  for (const machineId of machineIds) {
    await projectAssignedTaskSnapshotsForMachine(ctx, machineId);
  }
}

/** Patch delivery-config fields on existing snapshot rows for one role. */
// fallow-ignore-next-line complexity
export async function refreshSnapshotDeliveryConfigForChatroomRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  const { configs: allConfigs } = await loadRemoteConfigsForChatroom(ctx, chatroomId);
  const configs = allConfigs.filter((config) => config.role.toLowerCase() === role.toLowerCase());
  const rows = await listSnapshotRowsForChatroomRole(ctx, chatroomId, role);
  const now = Date.now();
  for (const row of rows) {
    const config = configs.find((candidate) => candidate.machineId === row.machineId);
    if (!config) continue;
    const patch = {
      agentHarness: config.agentHarness ?? 'opencode',
      model: config.model,
      workingDir: config.workingDir,
      configUpdatedAt: config.updatedAt,
      revisionKey: buildAssignedTaskRevisionKey({
        taskUpdatedAt: row.taskUpdatedAt,
        configUpdatedAt: config.updatedAt,
        taskId: row.taskId,
        role: config.role,
      }),
      signalUpdatedAt: now,
    };
    if (
      row.agentHarness !== patch.agentHarness ||
      row.model !== patch.model ||
      row.workingDir !== patch.workingDir ||
      row.configUpdatedAt !== patch.configUpdatedAt ||
      row.revisionKey !== patch.revisionKey
    )
      await ctx.db.patch('chatroom_machineAssignedTaskSnapshots', row._id, patch);
  }
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
