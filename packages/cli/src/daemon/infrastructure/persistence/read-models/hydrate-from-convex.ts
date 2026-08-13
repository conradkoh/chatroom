import type { DatabaseSync } from 'node:sqlite';

import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';

import { api } from '../../../../api.js';
import { mapAssignedTaskSnapshotList } from '../../../../infrastructure/mappers/map-assigned-task.js';
import { taskReadModelFromSnapshot, upsertTaskReadModel } from './tasks.js';

export type HydrateReadModelsDeps = {
  db: DatabaseSync;
  machineId: string;
  sessionId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  mutation?: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

export async function hydrateReadModelsFromConvex(
  deps: HydrateReadModelsDeps
): Promise<{ taskCount: number }> {
  if (deps.mutation) {
    await deps.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
    });
  }

  const result = (await deps.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  })) as { tasks?: unknown } | undefined;
  const snapshots = mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(result?.tasks ?? []));
  for (const snapshot of snapshots) {
    upsertTaskReadModel(deps.db, taskReadModelFromSnapshot(snapshot));
  }
  return { taskCount: snapshots.length };
}
