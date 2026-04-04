/**
 * Command Favorites Store — localStorage-backed favorites for the Process Manager.
 */

const STORAGE_KEY = 'chatroom:command-favorites';

export class CommandFavoritesStore {
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
