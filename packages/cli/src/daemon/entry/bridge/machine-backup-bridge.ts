/**
 * Builds the machine backup service's ports from the daemon session.
 * Argument mapping only, no logic.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';

import { api } from '../../../api.js';
import { assertUploadUrlAllowed } from '../../../infrastructure/file-attachments/upload-url-guard.js';
import type { MachineBackupPorts } from '../../domain/usecase/machine-backup-service.js';
import { resolveUserBackupsDirFromProcess } from '../../infrastructure/local/user-backups-dir.js';
import {
  listBackupDir,
  statBackupFile,
  uploadBackupFile,
} from '../../infrastructure/local/user-backups-fs.js';
import type { DaemonSessionServiceShape } from '../daemon-services.js';

export function createMachineBackupPorts(session: DaemonSessionServiceShape): MachineBackupPorts {
  const identity = { sessionId: session.sessionId, machineId: session.machineId };
  return {
    resolveBackupDir: resolveUserBackupsDirFromProcess,
    listDir: listBackupDir,
    statFile: statBackupFile,
    assertUploadUrl: (uploadUrl) =>
      assertUploadUrlAllowed(uploadUrl, session.convexUrl, (message) => new Error(message)),
    uploadFile: uploadBackupFile,
    reportInventory: (report) =>
      session.backend.mutation(api.machineBackups.reportInventory, { ...identity, ...report }),
    createUploadUrl: (args) =>
      session.backend.mutation(api.machineBackups.createUploadUrl, { ...identity, ...args }),
    reportUploaded: (report) =>
      session.backend.mutation(api.machineBackups.reportUploaded, {
        ...identity,
        ...report,
        storageId: report.storageId as Id<'_storage'>,
      }),
    reportFailed: (report) =>
      session.backend.mutation(api.machineBackups.reportFailed, { ...identity, ...report }),
  };
}
