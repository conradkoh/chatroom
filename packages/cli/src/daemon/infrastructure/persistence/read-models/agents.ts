import type { DatabaseSync } from 'node:sqlite';

import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';

export type AgentReadModelRow = {
  machineId: string;
  role: string;
  pid?: number;
  harnessSessionId?: string;
  updatedAt: number;
};

/** Maps an assigned-task snapshot's agent config to the agent read model. */
export function agentReadModelFromSnapshot(snapshot: AssignedTaskSnapshotView): AgentReadModelRow {
  return {
    machineId: snapshot.agentConfig.machineId,
    role: snapshot.agentConfig.role,
    pid: snapshot.agentConfig.spawnedAgentPid,
    updatedAt: snapshot.updatedAt,
  };
}

export function upsertAgentReadModel(db: DatabaseSync, row: AgentReadModelRow): void {
  db.prepare(
    `INSERT INTO read_model_agents(machine_id, role, pid, harness_session_id, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(machine_id, role) DO UPDATE SET
       pid = excluded.pid,
       harness_session_id = excluded.harness_session_id,
       updated_at = excluded.updated_at`
  ).run(row.machineId, row.role, row.pid ?? null, row.harnessSessionId ?? null, row.updatedAt);
}

// Test-only read helper (consumed by hydrate/shadow tests).
// fallow-ignore-next-line unused-export
export function getAgentReadModel(
  db: DatabaseSync,
  machineId: string,
  role: string
): AgentReadModelRow | null {
  const row = db
    .prepare(
      `SELECT machine_id as machineId, role, pid, harness_session_id as harnessSessionId,
              updated_at as updatedAt
       FROM read_model_agents WHERE machine_id = ? AND role = ?`
    )
    .get(machineId, role) as
    | {
        machineId: string;
        role: string;
        pid: number | null;
        harnessSessionId: string | null;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;
  return {
    machineId: row.machineId,
    role: row.role,
    pid: row.pid ?? undefined,
    harnessSessionId: row.harnessSessionId ?? undefined,
    updatedAt: row.updatedAt,
  };
}
