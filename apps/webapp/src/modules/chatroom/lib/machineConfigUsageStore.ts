/**
 * MachineConfigUsageStore — localStorage-backed usage tracking for machine configs.
 * Mirrors commandUsageStore.ts pattern with scope-keyed storage.
 *
 * Key structure: scopeKey (machineId|teamRoleKey) → configKey (harness|model) → timestamps[]
 *
 * Version 2: scoped by machineId+teamRoleKey instead of bare machineId.
 */

import type { MachineConfigEntry } from '../types/machineConfig';
import { buildMachineConfigKey } from '../types/machineConfig';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS_PER_CONFIG = 100;
const STORAGE_KEY = 'chatroom:machine-config-usage';

interface StorageData {
  scopes: Record<string, Record<string, number[]>>;
  version: 2;
}

// fallow-ignore-next-line complexity
class MachineConfigUsageStore {
  private data: StorageData;

  constructor() {
    this.data = this.load();
  }

  recordUsage(scopeKey: string, entry: MachineConfigEntry): void {
    const key = buildMachineConfigKey(entry);
    const scopes = this.data.scopes;
    if (!scopes[scopeKey]) scopes[scopeKey] = {};
    const timestamps = scopes[scopeKey][key] ?? [];
    timestamps.push(Date.now());
    if (timestamps.length > MAX_TIMESTAMPS_PER_CONFIG) {
      timestamps.splice(0, timestamps.length - MAX_TIMESTAMPS_PER_CONFIG);
    }
    scopes[scopeKey][key] = timestamps;
    this.save();
  }

  clearUsage(scopeKey: string, entry: MachineConfigEntry): void {
    const key = buildMachineConfigKey(entry);
    const scopes = this.data.scopes;
    if (scopes[scopeKey]) {
      delete scopes[scopeKey][key];
      if (Object.keys(scopes[scopeKey]).length === 0) {
        delete scopes[scopeKey];
      }
    }
    this.save();
  }

  getTimestamps(scopeKey: string, entry: MachineConfigEntry): number[] {
    const cutoff = Date.now() - MAX_AGE_MS;
    const key = buildMachineConfigKey(entry);
    const timestamps = this.data.scopes[scopeKey]?.[key] ?? [];
    return timestamps.filter((t) => t > cutoff);
  }

  getAllUsageForScope(scopeKey: string): Map<string, number[]> {
    const result = new Map<string, number[]>();
    const configs = this.data.scopes[scopeKey];
    if (!configs) return result;
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [key, timestamps] of Object.entries(configs)) {
      const pruned = timestamps.filter((t) => t > cutoff);
      if (pruned.length > 0) result.set(key, pruned);
    }
    return result;
  }

  clear(): void {
    this.data = { scopes: {}, version: 2 };
    this.save();
  }

  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { scopes: {}, version: 2 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { scopes: {}, version: 2 };
      const parsed = JSON.parse(raw) as StorageData;
      if (parsed.version !== 2) return { scopes: {}, version: 2 };
      return parsed;
    } catch {
      return { scopes: {}, version: 2 };
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
