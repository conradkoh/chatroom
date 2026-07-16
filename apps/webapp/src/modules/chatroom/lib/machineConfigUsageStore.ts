/**
 * MachineConfigUsageStore — localStorage-backed usage tracking for machine configs.
 * Mirrors commandUsageStore.ts pattern with machine-scoped keys.
 *
 * Key structure: machineId → configKey (harness|model) → timestamps[]
 */

import type { MachineConfigEntry } from '../types/machineConfig';
import { buildMachineConfigKey } from '../types/machineConfig';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS_PER_CONFIG = 100;
const STORAGE_KEY = 'chatroom:machine-config-usage';

interface StorageData {
  machines: Record<string, Record<string, number[]>>;
  version: 1;
}

// fallow-ignore-next-line unused-export
// fallow-ignore-next-line complexity
export class MachineConfigUsageStore {
  private data: StorageData;

  constructor() {
    this.data = this.load();
  }

  recordUsage(machineId: string, entry: MachineConfigEntry): void {
    const key = buildMachineConfigKey(entry);
    const machines = this.data.machines;
    if (!machines[machineId]) machines[machineId] = {};
    const timestamps = machines[machineId][key] ?? [];
    timestamps.push(Date.now());
    if (timestamps.length > MAX_TIMESTAMPS_PER_CONFIG) {
      timestamps.splice(0, timestamps.length - MAX_TIMESTAMPS_PER_CONFIG);
    }
    machines[machineId][key] = timestamps;
    this.save();
  }

  clearUsage(machineId: string, entry: MachineConfigEntry): void {
    const key = buildMachineConfigKey(entry);
    const machines = this.data.machines;
    if (machines[machineId]) {
      delete machines[machineId][key];
      if (Object.keys(machines[machineId]).length === 0) {
        delete machines[machineId];
      }
    }
    this.save();
  }

  getTimestamps(machineId: string, entry: MachineConfigEntry): number[] {
    const cutoff = Date.now() - MAX_AGE_MS;
    const key = buildMachineConfigKey(entry);
    const timestamps = this.data.machines[machineId]?.[key] ?? [];
    return timestamps.filter((t) => t > cutoff);
  }

  getAllUsageForMachine(machineId: string): Map<string, number[]> {
    const result = new Map<string, number[]>();
    const configs = this.data.machines[machineId];
    if (!configs) return result;
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [key, timestamps] of Object.entries(configs)) {
      const pruned = timestamps.filter((t) => t > cutoff);
      if (pruned.length > 0) result.set(key, pruned);
    }
    return result;
  }

  clear(): void {
    this.data = { machines: {}, version: 1 };
    this.save();
  }

  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { machines: {}, version: 1 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { machines: {}, version: 1 };
      const parsed = JSON.parse(raw) as StorageData;
      if (parsed.version !== 1) return { machines: {}, version: 1 };
      return parsed;
    } catch {
      return { machines: {}, version: 1 };
    }
  }

  private save(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // silently fail
    }
  }
}

let instance: MachineConfigUsageStore | null = null;

export function getMachineConfigUsageStore(): MachineConfigUsageStore {
  if (!instance) {
    instance = new MachineConfigUsageStore();
  }
  return instance;
}
