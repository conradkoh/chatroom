// fallow-ignore-file unused-file unused-export
import type { DatabaseSync } from 'node:sqlite';

import { listTaskReadModelsForMachine, taskReadModelToSnapshot } from './tasks.js';
import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';

export function listSnapshotViewsFromReadModels(
  db: DatabaseSync,
  machineId: string
): AssignedTaskSnapshotView[] {
  return listTaskReadModelsForMachine(db, machineId).map(taskReadModelToSnapshot);
}
