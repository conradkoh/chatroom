/**
 * Task-monitor working snapshot — domain merge rules over shared WorkingSnapshot.
 */

import {
  applyAssignedTaskPresence,
  applyAssignedTaskSignal,
} from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-row.js';
import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
  AssignedTaskSnapshotView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  WorkingSnapshot,
  type WorkingSnapshotOptions,
} from '../../../infrastructure/incremental-sync/working-snapshot.js';

function taskSnapshotKey(taskId: string, role: string): string {
  return `${taskId}:${role}`;
}

const taskMonitorSnapshotOptions: WorkingSnapshotOptions<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> = {
  rowKey: (row) => taskSnapshotKey(row.taskId, row.agentConfig.role),
  signalKey: (signal) => taskSnapshotKey(signal.taskId, signal.role),
  mergeSignal: applyAssignedTaskSignal,
};

export function createTaskMonitorSnapshot(): WorkingSnapshot<
  AssignedTaskSnapshotView,
  AssignedTaskSignal
> & {
  mergePresence(presence: AssignedTaskPresenceSignal): AssignedTaskSnapshotView | undefined;
} {
  const base = new WorkingSnapshot(taskMonitorSnapshotOptions);
  return Object.assign(base, {
    mergePresence(presence: AssignedTaskPresenceSignal) {
      const key = taskSnapshotKey(presence.taskId, presence.role);
      const existing = base.getByKey(key);
      const merged = applyAssignedTaskPresence(existing, presence);
      if (merged) {
        base.upsertRow(merged);
      }
      return merged;
    },
  });
}
