import {
  loadMachineConfig,
  ensureMachineRegistered,
  getMachineId,
  getMachineConfigPath,
} from '../../../infrastructure/machine/storage.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';

export type { MachineConfig };

export interface MachineConfigPort {
  loadMachineConfig(): Promise<MachineConfig | null>;
  ensureMachineRegistered(
    options?: Parameters<typeof ensureMachineRegistered>[0]
  ): ReturnType<typeof ensureMachineRegistered>;
  getMachineId(): Promise<string | null>;
  getMachineConfigPath(): string;
}

export function createMachineConfigPort(): MachineConfigPort {
  return { loadMachineConfig, ensureMachineRegistered, getMachineId, getMachineConfigPath };
}
