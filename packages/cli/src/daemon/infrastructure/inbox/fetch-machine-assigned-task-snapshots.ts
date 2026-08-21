import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';

import { api } from '../../../api.js';
import { mapAssignedTaskSnapshotList } from '../../../infrastructure/mappers/map-assigned-task.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';

export async function fetchMachineAssignedTaskSnapshots(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<AssignedTaskSnapshotView[]> {
  const result = await sessionDeps.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: sessionDeps.sessionId,
    machineId,
  });
  return mapAssignedTaskSnapshotList(
    parseAssignedTaskMonitorRows((result as { tasks?: unknown })?.tasks ?? [])
  );
}

export function filterSnapshotsForRole(
  snapshots: readonly AssignedTaskSnapshotView[],
  chatroomId: string,
  role: string
): AssignedTaskSnapshotView[] {
  const roleLower = role.toLowerCase();
  return snapshots.filter(
    (row) => row.chatroomId === chatroomId && row.agentConfig.role.toLowerCase() === roleLower
  );
}
