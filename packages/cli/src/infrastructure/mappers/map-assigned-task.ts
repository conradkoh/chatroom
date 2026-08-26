import type {
  AssignedTaskSnapshotView as BackendAssignedTaskSnapshotView,
  AssignedTaskView as BackendAssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../daemon/domain/entities/assigned-task.js';

export function mapAssignedTaskSnapshot(
  row: BackendAssignedTaskSnapshotView
): AssignedTaskSnapshotView {
  return {
    taskId: row.taskId,
    chatroomId: row.chatroomId,
    status: row.status,
    assignedTo: row.assignedTo,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    agentConfig: {
      role: row.agentConfig.role,
      machineId: row.agentConfig.machineId,
      agentHarness: row.agentConfig.agentHarness,
      model: row.agentConfig.model,
      workingDir: row.agentConfig.workingDir,
      spawnedAgentPid: row.agentConfig.spawnedAgentPid,
      desiredState: row.agentConfig.desiredState,
      circuitState: row.agentConfig.circuitState,
      configLifecycleRevision: row.agentConfig.configLifecycleRevision,
    },
    participant: row.participant,
  };
}

export function mapAssignedTaskView(row: BackendAssignedTaskView): AssignedTaskWithContent {
  return {
    ...mapAssignedTaskSnapshot(row),
    taskContent: row.taskContent,
    startInNewSession: row.startInNewSession,
  };
}

export function mapAssignedTaskSnapshotList(
  rows: readonly BackendAssignedTaskSnapshotView[]
): AssignedTaskSnapshotView[] {
  return rows.map(mapAssignedTaskSnapshot);
}
