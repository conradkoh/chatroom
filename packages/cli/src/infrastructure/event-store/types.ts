/**
 * Event Store — shared types for the daemon-local SQLite event sink.
 *
 * Phase 1 stores a minimal envelope (mutation args only) so the full Convex
 * event variant can be rebuilt in Phase 2 from `type` + `payload`.
 */

export interface StoredEvent {
  /** UUID, local primary key. */
  id: string;
  chatroomId: string;
  machineId: string;
  /** Convex event variant string (see daemon-event-types.ts). */
  type: string;
  /** Epoch ms — matches Convex event.timestamp. */
  timestamp: number;
  /** JSON of the mutation args sent to Convex (no `_id`, no derived fields). */
  payload: string;
}

export type AppendEventInput = Omit<StoredEvent, 'id'>;

export interface ListByChatroomArgs {
  chatroomId: string;
  limit?: number;
  /** Base64 JSON { timestamp: number; id: string } keyset cursor. */
  cursor?: string;
}

export interface ListByChatroomResult {
  page: StoredEvent[];
  continueCursor: string | null;
  isDone: boolean;
}

export interface EventStore {
  append(input: AppendEventInput): string;
  listByChatroom(args: ListByChatroomArgs): ListByChatroomResult;
  close(): void;
}

export interface SqliteEventStoreOptions {
  readOnly?: boolean;
}
