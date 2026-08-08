// fallow-ignore-file unused-file unused-export
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { TaskReadModelRow } from '../../infrastructure/persistence/read-models/tasks.js';

export type TaskReadModelsPort = {
  upsertTask(row: TaskReadModelRow): void;
  listTasksForMachine(machineId: string): AssignedTaskSnapshotView[];
};
