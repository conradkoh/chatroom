/**
 * CommandBlacklistStore — localStorage-backed set of blacklisted command IDs.
 *
 * Blacklisted commands remain visible but sort to the bottom of the palette.
 */

const STORAGE_KEY = 'chatroom:command-blacklist';

interface StorageData {
  commandIds: string[];
  version: 1;
}

const listeners = new Set<() => void>();
let revision = 0;

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

class CommandBlacklistStore {
  private data: StorageData;

  constructor() {
    this.data = this.load();
  }

  add(commandId: string): void {
    if (this.data.commandIds.includes(commandId)) return;
    this.data.commandIds.push(commandId);
    this.save();
  }

  remove(commandId: string): void {
    const idx = this.data.commandIds.indexOf(commandId);
    if (idx === -1) return;
    this.data.commandIds.splice(idx, 1);
    this.save();
  }

  has(commandId: string): boolean {
    return this.data.commandIds.includes(commandId);
  }

  getAll(): Set<string> {
    return new Set(this.data.commandIds);
  }

  clear(): void {
    this.data = { commandIds: [], version: 1 };
    this.save();
  }

  private load(): StorageData {
    try {
      if (typeof window === 'undefined') return { commandIds: [], version: 1 };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { commandIds: [], version: 1 };
      const parsed = JSON.parse(raw) as StorageData;
      if (parsed.version !== 1) return { commandIds: [], version: 1 };
      if (!Array.isArray(parsed.commandIds)) return { commandIds: [], version: 1 };
      return parsed;
    } catch {
      return { commandIds: [], version: 1 };
    }
  }

  private save(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      emit();
    } catch {
      // localStorage full or unavailable — silently fail
    }
  }
}

let instance: CommandBlacklistStore | null = null;

export function getCommandBlacklistStore(): CommandBlacklistStore {
  if (!instance) {
    instance = new CommandBlacklistStore();
  }
  return instance;
}

export function subscribeCommandBlacklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCommandBlacklistRevision(): number {
  return revision;
}
