/**
 * Chatroom import — the interrupted-import record.
 *
 * The record lives in `localStorage` because it must survive the tab closing
 * (a notice shown after close is the whole point) and `sessionStorage` does not.
 * Two tabs share it, so the importing tab refreshes `heartbeatAt` every few
 * seconds and a record is only offered for removal once its heartbeat is old:
 * a live import in another tab is never mistaken for a dead one.
 *
 * Every `localStorage` access is guarded: privacy modes throw on read and write.
 */

// Both constants are the record's contract and are asserted by the unit tests.
// fallow-ignore-next-line unused-export
export const INFLIGHT_IMPORT_STORAGE_KEY = 'chatroom.import.inflight';
export const INFLIGHT_IMPORT_HEARTBEAT_MS = 5_000;
/** A record whose heartbeat is older than this belongs to a tab that is gone, not to an import still running. */
// fallow-ignore-next-line unused-export
export const INFLIGHT_IMPORT_STALE_MS = 20_000;

export interface InflightImportRecord {
  chatroomId: string;
  startedAt: number;
  heartbeatAt: number;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readInflightImport(): InflightImportRecord | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(INFLIGHT_IMPORT_STORAGE_KEY);
    return raw === null ? null : parseRecord(raw);
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
function parseRecord(raw: string): InflightImportRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.chatroomId !== 'string' || record.chatroomId === '') return null;
  if (!isNumber(record.startedAt) || !isNumber(record.heartbeatAt)) return null;
  return {
    chatroomId: record.chatroomId,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
  };
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function writeInflightImport(chatroomId: string, now: number): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(
      INFLIGHT_IMPORT_STORAGE_KEY,
      JSON.stringify({ chatroomId, startedAt: now, heartbeatAt: now })
    );
  } catch {
    // A full or unavailable store must not interrupt an import.
  }
}

/** Refresh the heartbeat of the record already stored, if any. */
export function touchInflightImport(now: number): void {
  const record = readInflightImport();
  if (record === null) return;
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(INFLIGHT_IMPORT_STORAGE_KEY, JSON.stringify({ ...record, heartbeatAt: now }));
  } catch {
    // See writeInflightImport.
  }
}

export function clearInflightImport(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(INFLIGHT_IMPORT_STORAGE_KEY);
  } catch {
    // See writeInflightImport.
  }
}

export function isStaleInflightImport(record: InflightImportRecord, now: number): boolean {
  return now - record.heartbeatAt > INFLIGHT_IMPORT_STALE_MS;
}
