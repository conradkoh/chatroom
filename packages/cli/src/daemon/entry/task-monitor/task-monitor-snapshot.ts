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
  AssignedTaskSnapshotView as BackendAssignedTaskSnapshotView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import {
  WorkingSnapshot,
  type WorkingSnapshotOptions,
} from '../../../infrastructure/incremental-sync/working-snapshot.js';
import { mapAssignedTaskSnapshot } from '../../../infrastructure/mappers/map-assigned-task.js';

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
    const merged = applyAssignedTaskSignal(
      row as BackendAssignedTaskSnapshotView | undefined,
      signal
    );
    return mapAssignedTaskSnapshot(merged);
  },
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
      const merged = applyAssignedTaskPresence(
        existing as BackendAssignedTaskSnapshotView | undefined,
        presence
      );
      if (merged) {
        const mapped = mapAssignedTaskSnapshot(merged);
        base.upsertRow(mapped);
        return mapped;
      }
      return undefined;
    },
  });
}
