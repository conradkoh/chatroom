/**
 * MachineConfigUsageStore — localStorage-backed usage tracking for machine configs.
 *
 * Key structure: scopeKey (machineId|teamRoleKey) → configKey (harness|model) → timestamps[]
 *
 * Version 2: scoped by machineId+teamRoleKey instead of bare machineId.
 * Version 3: teamRole portion drops chatroomId prefix.
 *   Old: m1|chatroom_room1#team_duo#role_planner
 *   New: m1|team_duo#role_planner
 */

import type { MachineConfigEntry } from '../../../types/machineConfig';
import { buildMachineConfigKey } from '../../../types/machineConfig';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS_PER_CONFIG = 100;
const STORAGE_KEY = 'chatroom:machine-config-usage';

interface StorageData {
  scopes: Record<string, Record<string, number[]>>;
  version: 3;
}

const listeners = new Set<() => void>();
let revision = 0;

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function migrateV2Scopes(
  scopes: Record<string, Record<string, number[]>>
): Record<string, Record<string, number[]>> {
  const result: Record<string, Record<string, number[]>> = {};
  for (const [scopeKey, configs] of Object.entries(scopes)) {
    const pipeIdx = scopeKey.indexOf('|');
    if (pipeIdx === -1) continue;
    const machineId = scopeKey.slice(0, pipeIdx);
    const teamRolePart = scopeKey.slice(pipeIdx + 1);
    const normalized = teamRolePart.replace(/^chatroom_[^#]+#/, '');
    const newKey = `${machineId}|${normalized}`;
    if (!result[newKey]) result[newKey] = {};
    for (const [configKey, timestamps] of Object.entries(configs)) {
      const existing = result[newKey][configKey] ?? [];
      result[newKey][configKey] = [...existing, ...timestamps].sort((a, b) => a - b);
    }
  }
  return result;
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
    this.data = { scopes: {}, version: 3 };
    this.save();
  }

  // fallow-ignore-next-line complexity
  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { scopes: {}, version: 3 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { scopes: {}, version: 3 };
      const parsed = JSON.parse(raw) as StorageData & { version?: number };
      if (parsed.version === 3) return parsed as StorageData;
      if (parsed.version === 2) {
        return { scopes: migrateV2Scopes(parsed.scopes), version: 3 };
      }
      return { scopes: {}, version: 3 };
    } catch {
      return { scopes: {}, version: 3 };
    }
  }

  private save(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      emit();
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

export function subscribeMachineConfigUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMachineConfigUsageRevision(): number {
  return revision;
}
