import type { DatabaseSync } from 'node:sqlite';

import { listTaskReadModelsForMachine, taskReadModelToSnapshot } from './tasks.js';
import type {
  ActiveTaskStatus,
  AssignedTaskSnapshotView,
} from '../../../domain/entities/assigned-task.js';

const ACTIVE_TASK_STATUSES: readonly ActiveTaskStatus[] = [
  'pending',
  'acknowledged',
  'in_progress',
];

export function listSnapshotViewsFromReadModels(
  db: DatabaseSync,
  machineId: string
): AssignedTaskSnapshotView[] {
  return listTaskReadModelsForMachine(db, machineId)
    .filter((row) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(row.status))
    .map(taskReadModelToSnapshot);
}
