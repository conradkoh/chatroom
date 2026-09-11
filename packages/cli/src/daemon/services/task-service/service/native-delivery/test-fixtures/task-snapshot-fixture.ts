// fallow-ignore-file unused-file
/**
 * Task-monitor working snapshot — domain merge rules over shared WorkingSnapshot.
 */

import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  WorkingSnapshot,
  type WorkingSnapshotOptions,
} from '../../../../../../infrastructure/incremental-sync/working-snapshot.js';
import type { AssignedTaskSnapshotView } from '../../../../../domain/entities/assigned-task.js';

export type TaskSnapshotFixtureDoc = {
  taskId: AssignedTaskSignal['taskId'];
  chatroomId: AssignedTaskSignal['chatroomId'];
  role: string;
  taskStatus: AssignedTaskSignal['status'];
  taskAssignedTo?: string;
  taskCreatedAt: number;
  taskUpdatedAt: number;
  machineId: string;
  agentHarness: string;
  workingDir?: string;
  requestsNativeColdSession?: boolean;
  configUpdatedAt: number;
  revisionKey: string;
};

export function snapshotDocToSignal(doc: TaskSnapshotFixtureDoc): AssignedTaskSignal {
  return {
    taskId: doc.taskId,
    chatroomId: doc.chatroomId,
    role: doc.role,
    status: doc.taskStatus,
    signalType: 'task',
    revisionKey: doc.revisionKey,
    machineId: doc.machineId,
    agentHarness: doc.agentHarness,
    workingDir: doc.workingDir,
    assignedTo: doc.taskAssignedTo,
    requestsNativeColdSession: doc.requestsNativeColdSession,
    createdAt: doc.taskCreatedAt,
  };
}

function taskSnapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}

const taskMonitorSnapshotOptions: WorkingSnapshotOptions<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> = {
  rowKey: (row) => taskSnapshotKey(row.taskId, row.agentConfig.role),
  signalKey: (signal) => taskSnapshotKey(signal.taskId, signal.role),
  mergeSignal: (row, signal) => {
    if (!row) {
      return {
        taskId: signal.taskId,
        chatroomId: signal.chatroomId,
        status: signal.status,
        assignedTo: signal.assignedTo,
        updatedAt: signal.createdAt,
        createdAt: signal.createdAt,
        requestsNativeColdSession: signal.requestsNativeColdSession,
        agentConfig: {
          role: signal.role,
          machineId: signal.machineId,
          agentHarness: signal.agentHarness,
          workingDir: signal.workingDir,
        },
      };
    }
    return {
      ...row,
      status: signal.status,
      requestsNativeColdSession: signal.requestsNativeColdSession ?? row.requestsNativeColdSession,
    };
  },
};

export function createTaskSnapshot(): WorkingSnapshot<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> & {
  mergePresence(presence: AssignedTaskPresenceSignal): AssignedTaskSnapshotView | undefined;
} {
  const base = new WorkingSnapshot(taskMonitorSnapshotOptions);
  return Object.assign(base, {
    mergePresence(presence: AssignedTaskPresenceSignal) {
      const key = taskSnapshotKey(presence.taskId, presence.role);
      return base.getByKey(key);
    },
  });
}
