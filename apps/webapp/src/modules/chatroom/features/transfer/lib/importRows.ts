/**
 * Import dialog — one view row per listed entry.
 *
 * The components render these rows and never derive status themselves, so the
 * progress and results steps cannot disagree about what happened to a chatroom.
 * Results win over the running entry, and the running entry wins over queued.
 */

import type {
  ListedEntry,
  TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';
import type { EntryImportResult } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-selection-driver';

export type ImportRowStatus =
  | { kind: 'queued' }
  | { kind: 'running'; chunksDone: number; chunksTotal: number; rollingBack: boolean }
  | { kind: 'imported'; chatroomId: string }
  | {
      kind: 'failed';
      code: string;
      message: string;
      rolledBack: boolean;
      orphanChatroomId?: string;
    }
  | { kind: 'skipped'; reason: 'cancelled' | 'fatal' };

export interface ImportRow {
  entry: ListedEntry;
  status: ImportRowStatus;
}

/** The running entry as the hook tracks it. `null` between entries. */
export interface CurrentImport {
  key: string;
  index: number;
  total: number;
  chunksDone: number;
  chunksTotal: number;
  chatroomId: string | null;
}

/** One row per key in `keys` order. Results win over the running entry; a running entry wins over queued. */
export function deriveImportRows(
  listing: TransferListing,
  keys: readonly string[],
  current: CurrentImport | null,
  results: readonly EntryImportResult[],
  cancelling: boolean
): ImportRow[] {
  const entries = new Map(listing.entries.map((entry) => [entry.key, entry]));
  const byKey = new Map(results.map((result) => [result.key, result]));

  return keys.flatMap((key) => {
    const entry = entries.get(key);
    if (entry === undefined) return [];
    return [{ entry, status: statusFor(byKey.get(key), current, key, cancelling) }];
  });
}

type StatusSource = EntryImportResult | undefined;

function statusFor(
  result: StatusSource,
  current: CurrentImport | null,
  key: string,
  cancelling: boolean
): ImportRowStatus {
  if (result !== undefined) return statusFromResult(result);
  if (current !== null && current.key === key) {
    return {
      kind: 'running',
      chunksDone: current.chunksDone,
      chunksTotal: current.chunksTotal,
      rollingBack: cancelling,
    };
  }
  return { kind: 'queued' };
}

/** `dry-run` never reaches the UI (the web dialog is never dry-run), so it reads as queued. */
// fallow-ignore-next-line complexity
function statusFromResult(result: EntryImportResult): ImportRowStatus {
  switch (result.status) {
    case 'imported':
      return { kind: 'imported', chatroomId: result.chatroomId };
    case 'failed': {
      const base = {
        kind: 'failed' as const,
        code: result.code,
        message: result.message,
        rolledBack: result.rolledBack,
      };
      return result.orphanChatroomId === undefined
        ? base
        : { ...base, orphanChatroomId: result.orphanChatroomId };
    }
    case 'skipped':
      return { kind: 'skipped', reason: result.reason };
    case 'dry-run':
      return { kind: 'queued' };
  }
}

// fallow-ignore-next-line complexity
export function countsFor(rows: readonly ImportRow[]): {
  imported: number;
  failed: number;
  skipped: number;
  queued: number;
  total: number;
} {
  const counts = { imported: 0, failed: 0, skipped: 0, queued: 0, total: rows.length };
  for (const row of rows) {
    if (row.status.kind === 'imported') counts.imported += 1;
    if (row.status.kind === 'failed') counts.failed += 1;
    if (row.status.kind === 'skipped') counts.skipped += 1;
    if (row.status.kind === 'queued') counts.queued += 1;
  }
  return counts;
}

/** Keys whose row is `failed` or `skipped`, in order: what "Retry N remaining" re-selects. */
export function failedOrSkippedKeys(rows: readonly ImportRow[]): string[] {
  return rows
    .filter((row) => row.status.kind === 'failed' || row.status.kind === 'skipped')
    .map((row) => row.entry.key);
}
