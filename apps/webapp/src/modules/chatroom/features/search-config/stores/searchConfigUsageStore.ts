/**
 * SearchConfigUsageStore — localStorage-backed usage tracking for agentic search configs.
 *
 * Key structure: machineId → configKey (harnessName|modelKey) → timestamps[]
 */

import type { SearchConfigEntry } from '../types/searchConfig';
import { buildSearchConfigKey } from '../types/searchConfig';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS_PER_CONFIG = 100;
const STORAGE_KEY = 'chatroom:search-config-usage';

interface StorageData {
  scopes: Record<string, Record<string, number[]>>;
  version: 1;
}

export class SearchConfigUsageStore {
  private data: StorageData;

  constructor() {
    this.data = this.load();
  }

  recordUsage(scopeKey: string, entry: SearchConfigEntry): void {
    const key = buildSearchConfigKey(entry);
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

  clearUsage(scopeKey: string, entry: SearchConfigEntry): void {
    const key = buildSearchConfigKey(entry);
    const scopes = this.data.scopes;
    if (scopes[scopeKey]) {
      delete scopes[scopeKey][key];
      if (Object.keys(scopes[scopeKey]).length === 0) {
        delete scopes[scopeKey];
      }
    }
    this.save();
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
    this.data = { scopes: {}, version: 1 };
    this.save();
  }

  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { scopes: {}, version: 1 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { scopes: {}, version: 1 };
      const parsed = JSON.parse(raw) as StorageData;
      if ((parsed as any).version !== 1) return { scopes: {}, version: 1 };
      return parsed;
    } catch {
      return { scopes: {}, version: 1 };
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

let instance: SearchConfigUsageStore | null = null;

export function getSearchConfigUsageStore(): SearchConfigUsageStore {
  if (!instance) {
    instance = new SearchConfigUsageStore();
  }
  return instance;
}
