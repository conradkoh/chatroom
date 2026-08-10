import type { DatabaseSync } from 'node:sqlite';

import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';

import { syncSnapshotsToReadModels } from './snapshot-sync.js';
import { api } from '../../../../api.js';
import { mapAssignedTaskSnapshotList } from '../../../../infrastructure/mappers/map-assigned-task.js';

export type HydrateReadModelsDeps = {
  db: DatabaseSync;
  machineId: string;
  sessionId: string;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

export type HydrateReadModelsResult = {
  taskCount: number;
  participantCount: number;
  agentCount: number;
};

export async function hydrateReadModelsFromConvex(
  deps: HydrateReadModelsDeps
): Promise<HydrateReadModelsResult> {
  const result = (await deps.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  })) as { tasks?: unknown } | undefined;
  const snapshots = mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(result?.tasks ?? []));
  return syncSnapshotsToReadModels(deps.db, snapshots);
}
