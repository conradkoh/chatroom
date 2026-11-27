import type {
  ListedEntry,
  TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';
import type { EntryImportResult } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-selection-driver';
import { describe, expect, it } from 'vitest';

import { countsFor, deriveImportRows, failedOrSkippedKeys, type CurrentImport } from './importRows';

function entry(key: string, ok = true): ListedEntry {
  return {
    key,
    position: Number(key.replace(/\D/g, '')) || 1,
    name: `Room ${key}`,
    sourceChatroomId: key,
    teamStructureId: 'duo',
    status: 'active',
    exportedAt: '2026-01-02T03:04:05.000Z',
    counts: { messages: 1, tasks: 0, backlog: 0 },
    workingDirCount: 1,
    omittedAttachments: { count: 0, bytes: 0 },
    validity: ok ? { ok: true } : { ok: false, code: 'IMPORT_CHECKSUM_MISMATCH', message: 'bad' },
  };
}

const LISTING: TransferListing = {
  kind: 'bundle',
  exportedAt: '2026-01-02T03:04:05.000Z',
  entries: [entry('a'), entry('b'), entry('c'), entry('d')],
  files: new Map(),
};

const CUR: CurrentImport = {
  key: 'b',
  index: 2,
  total: 4,
  chunksDone: 3,
  chunksTotal: 9,
  chatroomId: 'new-b',
};

describe('deriveImportRows', () => {
  it('keeps the keys order and marks an untouched entry queued', () => {
    const rows = deriveImportRows(LISTING, ['a', 'c'], null, [], false);
    expect(rows.map((row) => row.entry.key)).toEqual(['a', 'c']);
    expect(rows.map((row) => row.status)).toEqual([{ kind: 'queued' }, { kind: 'queued' }]);
  });

  it('reports the running entry with its chunk counters', () => {
    const rows = deriveImportRows(LISTING, ['a', 'b'], CUR, [], false);
    expect(rows[1].status).toEqual({
      kind: 'running',
      chunksDone: 3,
      chunksTotal: 9,
      rollingBack: false,
    });
  });

  it('marks the running entry as rolling back while cancelling', () => {
    const rows = deriveImportRows(LISTING, ['a', 'b'], CUR, [], true);
    expect(rows[1].status).toEqual({
      kind: 'running',
      chunksDone: 3,
      chunksTotal: 9,
      rollingBack: true,
    });
  });

  it('maps every finished result over its row', () => {
    const results: EntryImportResult[] = [
      { key: 'a', status: 'imported', chatroomId: 'new-a', plan: {} as never },
      {
        key: 'b',
        status: 'failed',
        code: 'IMPORT_ROLLED_BACK',
        message: 'rolled back',
        details: [],
        rolledBack: true,
      },
      {
        key: 'c',
        status: 'failed',
        code: 'IMPORT_ROLLBACK_FAILED',
        message: 'orphan',
        details: [],
        rolledBack: false,
        orphanChatroomId: 'new-c',
      },
      { key: 'd', status: 'skipped', reason: 'cancelled' },
    ];
    const rows = deriveImportRows(LISTING, ['a', 'b', 'c', 'd'], null, results, false);
    expect(rows.map((row) => row.status)).toEqual([
      { kind: 'imported', chatroomId: 'new-a' },
      { kind: 'failed', code: 'IMPORT_ROLLED_BACK', message: 'rolled back', rolledBack: true },
      {
        kind: 'failed',
        code: 'IMPORT_ROLLBACK_FAILED',
        message: 'orphan',
        rolledBack: false,
        orphanChatroomId: 'new-c',
      },
      { kind: 'skipped', reason: 'cancelled' },
    ]);
  });

  it('lets a finished result win over the running entry', () => {
    const results: EntryImportResult[] = [
      { key: 'b', status: 'imported', chatroomId: 'new-b', plan: {} as never },
    ];
    const rows = deriveImportRows(LISTING, ['b'], CUR, results, false);
    expect(rows[0].status).toEqual({ kind: 'imported', chatroomId: 'new-b' });
  });

  it('drops keys the listing does not contain', () => {
    const rows = deriveImportRows(LISTING, ['a', 'missing'], null, [], false);
    expect(rows.map((row) => row.entry.key)).toEqual(['a']);
  });
});

describe('countsFor', () => {
  it('counts each outcome and the total, leaving running out of every bucket', () => {
    const results: EntryImportResult[] = [
      { key: 'a', status: 'imported', chatroomId: 'new-a', plan: {} as never },
      {
        key: 'b',
        status: 'failed',
        code: 'IMPORT_CHUNK_FAILED',
        message: 'no',
        details: [],
        rolledBack: true,
      },
      { key: 'c', status: 'skipped', reason: 'fatal' },
    ];
    const rows = deriveImportRows(LISTING, ['a', 'b', 'c', 'd'], null, results, false);
    expect(countsFor(rows)).toEqual({ imported: 1, failed: 1, skipped: 1, queued: 1, total: 4 });
  });
});

describe('failedOrSkippedKeys', () => {
  it('returns failed and skipped keys in order, never imported or queued ones', () => {
    const results: EntryImportResult[] = [
      { key: 'a', status: 'imported', chatroomId: 'new-a', plan: {} as never },
      {
        key: 'b',
        status: 'failed',
        code: 'IMPORT_CHUNK_FAILED',
        message: 'no',
        details: [],
        rolledBack: true,
      },
      { key: 'c', status: 'skipped', reason: 'cancelled' },
    ];
    const rows = deriveImportRows(LISTING, ['a', 'b', 'c', 'd'], null, results, false);
    expect(failedOrSkippedKeys(rows)).toEqual(['b', 'c']);
  });
});
