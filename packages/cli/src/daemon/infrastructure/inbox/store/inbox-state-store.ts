import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from './open-database.js';
import { deleteInboxState, getInboxState, queryInboxState, saveInboxState } from './state-store.js';
import type { InboxStateKey, InboxStateQuery, InboxStateRecord } from './state-store.js';

export type { InboxStateKey, InboxStateQuery, InboxStateRecord } from './state-store.js';

export interface InboxStateStore {
  get<TState = unknown>(key: InboxStateKey): InboxStateRecord<TState> | null;
  save<TState>(key: InboxStateKey, state: TState, updatedAt?: number): void;
  query<TState = unknown>(options?: InboxStateQuery): InboxStateRecord<TState>[];
  delete(key: InboxStateKey): void;
  close(): void;
}

export function createInboxStateStore(dbPath: string): InboxStateStore {
  const db: DatabaseSync = openDatabase(dbPath);

  return {
    get: <TState = unknown>(key: InboxStateKey) => getInboxState<TState>(db, key),
    save: <TState>(key: InboxStateKey, state: TState, updatedAt?: number) =>
      saveInboxState(db, key, state, updatedAt),
    query: <TState = unknown>(options?: InboxStateQuery) => queryInboxState<TState>(db, options),
    delete: (key: InboxStateKey) => deleteInboxState(db, key),
    close: () => db.close(),
  };
}
