// fallow-ignore-file unused-export

import type {
  AssignedTask as BackendAssignedTask,
  AssignedTaskView as BackendAssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../daemon/domain/entities/assigned-task.js';

export function mapAssignedTask(row: BackendAssignedTask): AssignedTask {
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
      spawnedAgentPid: row.agentConfig.spawnedAgentPid,
      desiredState: row.agentConfig.desiredState,
      circuitState: row.agentConfig.circuitState,
    },
    assignee: row.assignee,
    participant: row.participant,
    requestsNativeColdSession: row.requestsNativeColdSession,
  };
}

export function mapAssignedTaskView(row: BackendAssignedTaskView): AssignedTaskWithContent {
  return {
    ...mapAssignedTask(row),
    taskContent: row.taskContent,
    taskEnvelope: row.taskEnvelope,
    startInNewSession: row.startInNewSession,
  };
}

export function mapAssignedTaskList(rows: readonly BackendAssignedTask[]): AssignedTask[] {
  return rows.map(mapAssignedTask);
}
