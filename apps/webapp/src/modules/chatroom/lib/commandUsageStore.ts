/**
 * CommandUsageStore — localStorage-backed command usage tracking.
 *
 * Stores timestamp arrays per command ID for frécency scoring.
 * Auto-prunes timestamps older than MAX_AGE_MS and bounds storage size.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max age for usage timestamps (30 days). */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Max timestamps stored per command. */
const MAX_TIMESTAMPS_PER_COMMAND = 100;

/** Max unique commands tracked. */
const MAX_COMMANDS = 500;

/** localStorage key prefix. */
const STORAGE_KEY = 'chatroom:command-usage';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Serialized format in localStorage. */
interface StorageData {
  /** Map of commandId → array of timestamps (Unix ms). */
  commands: Record<string, number[]>;
  /** Schema version for future migrations. */
  version: 1;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export class CommandUsageStore {
  private data: StorageData;

  constructor() {
    this.data = this.load();
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Record a command usage at the current time.
   */
  recordUsage(commandId: string): void {
    const now = Date.now();
    const timestamps = this.data.commands[commandId] ?? [];
    timestamps.push(now);

    // Prune: keep only the most recent MAX_TIMESTAMPS_PER_COMMAND
    if (timestamps.length > MAX_TIMESTAMPS_PER_COMMAND) {
      timestamps.splice(0, timestamps.length - MAX_TIMESTAMPS_PER_COMMAND);
    }

    this.data.commands[commandId] = timestamps;
    this.enforceCommandLimit();
    this.save();
  }

  /**
   * Get all usage timestamps for a specific command.
   * Returns timestamps pruned to MAX_AGE_MS.
   */
  getTimestamps(commandId: string): number[] {
    const cutoff = Date.now() - MAX_AGE_MS;
    const timestamps = this.data.commands[commandId] ?? [];
    return timestamps.filter((t) => t > cutoff);
  }

  /**
   * Get all command IDs with their timestamps.
   * Prunes expired entries and saves.
   */
  getAllUsage(): Map<string, number[]> {
    this.pruneExpired();
    const result = new Map<string, number[]>();
    for (const [id, timestamps] of Object.entries(this.data.commands)) {
      if (timestamps.length > 0) {
        result.set(id, timestamps);
      }
    }
    return result;
  }

  /**
   * Clear all usage data.
   */
  clear(): void {
    this.data = { commands: {}, version: 1 };
    this.save();
  }

  // ─── Private ────────────────────────────────────────────────────────

  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { commands: {}, version: 1 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { commands: {}, version: 1 };
      const parsed = JSON.parse(raw) as StorageData;
      if (parsed.version !== 1) return { commands: {}, version: 1 };
      return parsed;
    } catch {
      return { commands: {}, version: 1 };
    }
  }

  private save(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // localStorage full or unavailable — silently fail
    }
  }

  /**
   * Remove timestamps older than MAX_AGE_MS across all commands.
   * Delete commands with no remaining timestamps.
   */
  private pruneExpired(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    let changed = false;

    for (const [id, timestamps] of Object.entries(this.data.commands)) {
      const pruned = timestamps.filter((t) => t > cutoff);
      if (pruned.length !== timestamps.length) {
        changed = true;
        if (pruned.length === 0) {
          delete this.data.commands[id];
        } else {
          this.data.commands[id] = pruned;
        }
      }
    }

    if (changed) this.save();
  }

  /**
   * If too many commands are tracked, remove the least recently used.
   */
  private enforceCommandLimit(): void {
    const ids = Object.keys(this.data.commands);
    if (ids.length <= MAX_COMMANDS) return;

    // Sort by most recent timestamp (descending)
    const sorted = ids.sort((a, b) => {
      const aMax = Math.max(...(this.data.commands[a] ?? [0]));
      const bMax = Math.max(...(this.data.commands[b] ?? [0]));
      return bMax - aMax;
    });

    // Keep only the top MAX_COMMANDS
    const toRemove = sorted.slice(MAX_COMMANDS);
    for (const id of toRemove) {
      delete this.data.commands[id];
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: CommandUsageStore | null = null;

/**
 * Get the singleton CommandUsageStore instance.
 * Safe to call on server side (returns a no-op store).
 */
export function getCommandUsageStore(): CommandUsageStore {
  if (!instance) {
    instance = new CommandUsageStore();
  }
  return instance;
}
