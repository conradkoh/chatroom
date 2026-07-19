/**
 * Command Favorites Store — localStorage-backed favorites for the Process Manager.
 */

const STORAGE_KEY = 'chatroom:command-favorites';

const listeners = new Set<() => void>();
let revision = 0;

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

class CommandFavoritesStore {
  private favorites: Set<string>;

  constructor() {
    this.favorites = this.load();
  }

  isFavorite(commandName: string): boolean {
    return this.favorites.has(commandName);
  }

  toggle(commandName: string): boolean {
    if (this.favorites.has(commandName)) {
      this.favorites.delete(commandName);
    } else {
      this.favorites.add(commandName);
    }
    this.save();
    return this.favorites.has(commandName);
  }

  getAll(): Set<string> {
    return new Set(this.favorites);
  }

  clear(): void {
    this.favorites = new Set();
    this.save();
  }

  private load(): Set<string> {
    try {
      if (typeof window === 'undefined') return new Set();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    } catch {
      return new Set();
    }
  }

  private save(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.favorites]));
      emit();
    } catch {
      // silently fail
    }
  }
}

let instance: CommandFavoritesStore | null = null;

export function getCommandFavoritesStore(): CommandFavoritesStore {
  if (!instance) {
    instance = new CommandFavoritesStore();
  }
  return instance;
}

export function subscribeCommandFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCommandFavoritesRevision(): number {
  return revision;
}
