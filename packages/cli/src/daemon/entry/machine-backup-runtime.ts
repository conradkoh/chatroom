/**
 * Lazy process-wide holder for the machine backup service.
 *
 * Command dispatch must share ONE instance: the in-flight registry lives in the service, so a
 * second instance would let the same request run twice. Created on first use, after the daemon
 * session is available.
 */

import { createMachineBackupPorts } from './bridge/machine-backup-bridge.js';
import type { DaemonSessionServiceShape } from './daemon-services.js';
import {
  createMachineBackupService,
  type MachineBackupService,
} from '../domain/usecase/machine-backup-service.js';

let service: MachineBackupService | null = null;

/** One service per daemon process: the in-flight registry must be shared by every command. */
export function getMachineBackupService(session: DaemonSessionServiceShape): MachineBackupService {
  service ??= createMachineBackupService(createMachineBackupPorts(session));
  return service;
}
