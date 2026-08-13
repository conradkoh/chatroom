// fallow-ignore-file unused-export
import type { DatabaseSync } from 'node:sqlite';

import type {
  ActiveTaskStatus,
  AgentCircuitState,
  AgentDesiredState,
  AssignedTaskSnapshotView,
} from '../../../domain/entities/assigned-task.js';

export type TaskReadModelStatus = ActiveTaskStatus | 'completed' | 'queued';

export type TaskReadModelRow = {
  taskContent?: string;
  chatroomId: string;
  role: string;
  taskId: string;
  status: TaskReadModelStatus;
  assignedTo?: string;
  agentHarness: string;
  machineId: string;
  model?: string;
  workingDir?: string;
  spawnedAgentPid?: number;
  desiredState?: AgentDesiredState;
  circuitState?: AgentCircuitState;
  participantLastSeenAction?: string | null;
  participantLastSeenAt?: number | null;
  participantLastStatus?: string | null;
  createdAt: number;
  updatedAt: number;
};

const TASK_COLUMNS = `chatroom_id as chatroomId, role, task_id as taskId, status, task_content as taskContent, assigned_to as assignedTo,
  agent_harness as agentHarness, machine_id as machineId, model, working_dir as workingDir,
  spawned_agent_pid as spawnedAgentPid, desired_state as desiredState, circuit_state as circuitState,
  participant_last_seen_action as participantLastSeenAction, participant_last_seen_at as participantLastSeenAt,
  participant_last_status as participantLastStatus, created_at as createdAt, updated_at as updatedAt`;

// fallow-ignore-next-line complexity
function readTaskRow(row: {
  chatroomId: string;
  role: string;
  taskId: string;
  status: string;
  taskContent: string | null;
  assignedTo: string | null;
  agentHarness: string;
  machineId: string;
  model: string | null;
  workingDir: string | null;
  spawnedAgentPid: number | null;
  desiredState: string | null;
  circuitState: string | null;
  participantLastSeenAction: string | null;
  participantLastSeenAt: number | null;
  participantLastStatus: string | null;
  createdAt: number;
  updatedAt: number;
}): TaskReadModelRow {
  const hasParticipant =
    row.participantLastSeenAction !== null ||
    row.participantLastSeenAt !== null ||
    row.participantLastStatus !== null;
  return {
    chatroomId: row.chatroomId,
    role: row.role,
    taskId: row.taskId,
    status: row.status as TaskReadModelStatus,
    taskContent: row.taskContent ?? undefined,
    assignedTo: row.assignedTo ?? undefined,
    agentHarness: row.agentHarness,
    machineId: row.machineId,
    model: row.model ?? undefined,
    workingDir: row.workingDir ?? undefined,
    spawnedAgentPid: row.spawnedAgentPid ?? undefined,
    desiredState: (row.desiredState ?? undefined) as AgentDesiredState | undefined,
    circuitState: (row.circuitState ?? undefined) as AgentCircuitState | undefined,
    participantLastSeenAction: row.participantLastSeenAction,
    participantLastSeenAt: row.participantLastSeenAt,
    participantLastStatus: row.participantLastStatus,
    ...(hasParticipant
      ? {}
      : {
          participantLastSeenAction: undefined,
          participantLastSeenAt: undefined,
          participantLastStatus: undefined,
        }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// fallow-ignore-next-line complexity
export function upsertTaskReadModel(db: DatabaseSync, row: TaskReadModelRow): void {
  db.prepare(
    `INSERT INTO read_model_tasks(
       chatroom_id, role, task_id, status, task_content, assigned_to, agent_harness, machine_id, model,
       working_dir, spawned_agent_pid, desired_state, circuit_state,
       participant_last_seen_action, participant_last_seen_at, participant_last_status,
       created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chatroom_id, role, task_id) DO UPDATE SET
       status = excluded.status,
       task_content = excluded.task_content,
       assigned_to = excluded.assigned_to,
       agent_harness = excluded.agent_harness,
       machine_id = excluded.machine_id,
       model = excluded.model,
       working_dir = excluded.working_dir,
       spawned_agent_pid = excluded.spawned_agent_pid,
       desired_state = excluded.desired_state,
       circuit_state = excluded.circuit_state,
       participant_last_seen_action = excluded.participant_last_seen_action,
       participant_last_seen_at = excluded.participant_last_seen_at,
       participant_last_status = excluded.participant_last_status,
       updated_at = excluded.updated_at`
  ).run(
    row.chatroomId,
    row.role,
    row.taskId,
    row.status,
    row.taskContent ?? null,
    row.assignedTo ?? null,
    row.agentHarness,
    row.machineId,
    row.model ?? null,
    row.workingDir ?? null,
    row.spawnedAgentPid ?? null,
    row.desiredState ?? null,
    row.circuitState ?? null,
    row.participantLastSeenAction ?? null,
    row.participantLastSeenAt ?? null,
    row.participantLastStatus ?? null,
    row.createdAt,
    row.updatedAt
  );
}

export function deleteTaskReadModel(
  db: DatabaseSync,
  chatroomId: string,
  role: string,
  taskId: string
): void {
  db.prepare(`DELETE FROM read_model_tasks WHERE chatroom_id = ? AND role = ? AND task_id = ?`).run(
    chatroomId,
    role,
    taskId
  );
}

export function listTaskReadModelsForMachine(
  db: DatabaseSync,
  machineId: string
): TaskReadModelRow[] {
  const rows = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM read_model_tasks WHERE machine_id = ?`)
    .all(machineId) as Parameters<typeof readTaskRow>[0][];
  return rows.map(readTaskRow);
}

export function listTaskReadModelsForChatroomRole(
  db: DatabaseSync,
  chatroomId: string,
  role: string
): TaskReadModelRow[] {
  const rows = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM read_model_tasks WHERE chatroom_id = ? AND role = ?`)
    .all(chatroomId, role) as Parameters<typeof readTaskRow>[0][];
  return rows.map(readTaskRow);
}

export function listTaskReadModelsForChatroom(
  db: DatabaseSync,
  chatroomId: string
): TaskReadModelRow[] {
  const rows = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM read_model_tasks WHERE chatroom_id = ?`)
    .all(chatroomId) as Parameters<typeof readTaskRow>[0][];
  return rows.map(readTaskRow);
}

export function listActiveTaskReadModelsForChatroom(
  db: DatabaseSync,
  chatroomId: string
): TaskReadModelRow[] {
  return listTaskReadModelsForChatroom(db, chatroomId).filter(
    (task) => task.status === 'in_progress' || task.status === 'acknowledged'
  );
}

export function findNextQueuedTaskForChatroom(
  db: DatabaseSync,
  chatroomId: string
): TaskReadModelRow | null {
  const row = db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM read_model_tasks
       WHERE chatroom_id = ? AND status = 'queued'
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(chatroomId) as Parameters<typeof readTaskRow>[0] | undefined;
  return row ? readTaskRow(row) : null;
}

export function findTopPendingTaskForSender(
  db: DatabaseSync,
  chatroomId: string,
  senderRole: string
): TaskReadModelRow | null {
  const row = db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM read_model_tasks
       WHERE chatroom_id = ? AND status = 'pending' AND assigned_to = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(chatroomId, senderRole.toLowerCase()) as Parameters<typeof readTaskRow>[0] | undefined;
  return row ? readTaskRow(row) : null;
}

export function taskReadModelFromSnapshot(snapshot: AssignedTaskSnapshotView): TaskReadModelRow {
  return {
    chatroomId: snapshot.chatroomId,
    role: snapshot.agentConfig.role,
    taskId: snapshot.taskId,
    status: snapshot.status,
    assignedTo: snapshot.assignedTo,
    agentHarness: snapshot.agentConfig.agentHarness,
    machineId: snapshot.agentConfig.machineId,
    model: snapshot.agentConfig.model,
    workingDir: snapshot.agentConfig.workingDir,
    spawnedAgentPid: snapshot.agentConfig.spawnedAgentPid,
    desiredState: snapshot.agentConfig.desiredState,
    circuitState: snapshot.agentConfig.circuitState,
    participantLastSeenAction: snapshot.participant?.lastSeenAction,
    participantLastSeenAt: snapshot.participant?.lastSeenAt,
    participantLastStatus: snapshot.participant?.lastStatus,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function claimTaskReadModelLocally(db: DatabaseSync, chatroomId: string, role: string, taskId: string, now: number): TaskReadModelRow | null {
  const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM read_model_tasks WHERE chatroom_id = ? AND role = ? AND task_id = ? AND status = 'pending'`).get(chatroomId, role, taskId) as Parameters<typeof readTaskRow>[0] | undefined;
  if (!row) return null;
  const claimed = { ...readTaskRow(row), status: 'in_progress' as const, updatedAt: now };
  upsertTaskReadModel(db, claimed);
  return claimed;
}

export function listDeliverableSnapshotsForRole(db: DatabaseSync, chatroomId: string, role: string): AssignedTaskSnapshotView[] {
  return listTaskReadModelsForChatroomRole(db, chatroomId, role)
    .filter((row) => row.status === 'pending' || row.status === 'acknowledged' || row.status === 'in_progress')
    .map(taskReadModelToSnapshot);
}

export function getTaskContentFromReadModel(db: DatabaseSync, chatroomId: string, role: string, taskId: string): string | undefined {
  const row = db.prepare(`SELECT task_content as taskContent FROM read_model_tasks WHERE chatroom_id = ? AND role = ? AND task_id = ?`).get(chatroomId, role, taskId) as { taskContent: string | null } | undefined;
  return row?.taskContent ?? undefined;
}

// fallow-ignore-next-line complexity
export function taskReadModelToSnapshot(row: TaskReadModelRow): AssignedTaskSnapshotView {
  const hasParticipant =
    row.participantLastSeenAction !== undefined ||
    row.participantLastSeenAt !== undefined ||
    row.participantLastStatus !== undefined;
  return {
    taskId: row.taskId,
    chatroomId: row.chatroomId,
    status: row.status as ActiveTaskStatus,
    assignedTo: row.assignedTo,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    agentConfig: {
      role: row.role,
      machineId: row.machineId,
      agentHarness: row.agentHarness,
      model: row.model,
      workingDir: row.workingDir,
      spawnedAgentPid: row.spawnedAgentPid,
      desiredState: row.desiredState,
      circuitState: row.circuitState,
    },
    ...(hasParticipant
      ? {
          participant: {
            lastSeenAction: row.participantLastSeenAction ?? null,
            lastSeenAt: row.participantLastSeenAt ?? null,
            lastStatus: row.participantLastStatus ?? null,
          },
        }
      : {}),
  };
}
