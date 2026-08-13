// fallow-ignore-file unused-file
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { setNativeDeliveryReadModelDb } from './native-task-delivery-coordinator.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';
import { upsertTaskReadModel } from '../../infrastructure/persistence/read-models/tasks.js';

export function openNativeDeliveryTestDb(): DatabaseSync {
  return openDatabase(join(mkdtempSync(join(tmpdir(), 'native-delivery-test-')), 'events.sqlite'));
}

export function seedNativeDeliveryReadModel(
  db: DatabaseSync,
  row: AssignedTaskSnapshotView,
  content: string
): void {
  upsertTaskReadModel(db, {
    chatroomId: row.chatroomId,
    role: row.agentConfig.role,
    taskId: row.taskId,
    status: row.status,
    taskContent: content,
    assignedTo: row.assignedTo,
    agentHarness: row.agentConfig.agentHarness ?? 'cursor-sdk',
    machineId: row.agentConfig.machineId ?? 'machine',
    workingDir: row.agentConfig.workingDir,
    spawnedAgentPid: row.agentConfig.spawnedAgentPid,
    desiredState: row.agentConfig.desiredState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  setNativeDeliveryReadModelDb(db);
}

export function clearNativeDeliveryReadModel(): void {
  setNativeDeliveryReadModelDb(undefined);
}
