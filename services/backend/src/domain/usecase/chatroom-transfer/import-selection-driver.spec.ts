/**
 * Selection driver — independent imports, summary, abort and fatal handling.
 *
 * The port is a scripted `ChatroomImportPort`, the seam the driver owns; the
 * files are real `runExport` payloads. The second chatroom failing must leave
 * the first alone, an abort must roll back only the chatroom in progress, and a
 * target-wide refusal must stop the run with the rest `skipped: 'fatal'`.
 */

import { describe, expect, it } from 'vitest';

import { runExport, type ChatroomExportPort } from './export-driver';
import type { ExportRawRow, ExportStamp } from './export-read';
import type { ChatroomImportPort } from './import-driver';
import type { ListedEntry, TransferListing } from './import-listing';
import type { ImportTarget } from './import-plan';
import {
  runSelectedImports,
  type EntryImportResult,
  type ImportRunEvent,
} from './import-selection-driver';
import { ChatroomTransferError, TRANSFER_ERROR_CODES } from '../../entities/chatroom-transfer-file';
import type { ChatroomExportFileV1, ExportCategory } from '../../entities/chatroom-transfer-file';

const NOW = '2026-05-01T10:00:00.000Z';
/** A deliberately non-transfer failure, to prove an unknown code is reported, not thrown. */
const BEGIN_FAILED = 'BEGIN_FAILED';
/** A backend auth code, which import does not define. */
const AUTH_FAILED = 'AUTH_FAILED';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rawRow(id: string, creationTime: number, fields: Record<string, unknown>): ExportRawRow {
  return { id, creationTime, fields };
}

function rawRows(roomId: string, name: string): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [rawRow('room1', 1, { name, status: 'active', teamStructureId: 'trio@1' })],
    workspaces: [],
    agentConfigs: [],
    messages: [
      rawRow('msg1', 2, { senderRole: 'user', content: `hello from ${roomId}`, type: 'message' }),
    ],
    messageQueue: [],
    tasks: [],
    backlog: [],
    artifacts: [],
    contexts: [],
    scheduledPrompts: [],
    savedCommands: [],
    skillCustomizations: [],
  };
}

function emptyStamp(): ExportStamp {
  return {
    lastActivityAt: 1,
    nextQueuePosition: 1,
    latestMessage: null,
    taskCounts: null,
    latest: {},
    attachmentRows: { count: 0, capped: false, totalBytes: 0 },
  };
}

function exportPort(rows: Record<ExportCategory, ExportRawRow[]>): ChatroomExportPort {
  return {
    getStamp: async () => emptyStamp(),
    readPage: async ({ category }) => ({
      rows: rows[category],
      continueCursor: null,
      isDone: true,
    }),
  };
}

async function fileFor(roomId: string, name: string): Promise<ChatroomExportFileV1> {
  const { file } = await runExport(exportPort(rawRows(roomId, name)), {
    chatroomId: roomId,
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return file;
}

function entryOf(file: ChatroomExportFileV1, position: number): ListedEntry {
  return {
    key: file.source.chatroomId,
    position,
    name: typeof file.room.name === 'string' ? file.room.name : null,
    sourceChatroomId: file.source.chatroomId,
    teamStructureId: String(file.room.teamStructureId),
    status: 'active',
    exportedAt: file.exportedAt,
    counts: { messages: file.messages.length, tasks: 0, backlog: 0 },
    workingDirCount: 0,
    omittedAttachments: { count: 0, bytes: 0 },
    validity: { ok: true },
  };
}

interface Fixture {
  listing: TransferListing;
  keys: string[];
}

async function fixture(count: number): Promise<Fixture> {
  const files: ChatroomExportFileV1[] = [];
  for (let index = 0; index < count; index += 1) {
    files.push(await fileFor(`room-${index + 1}`, `Room ${index + 1}`));
  }
  return {
    listing: {
      exportedAt: NOW,
      entries: files.map(entryOf),
      files: new Map(files.map((file) => [file.source.chatroomId, file])),
    },
    keys: files.map((file) => file.source.chatroomId),
  };
}

// ---------------------------------------------------------------------------
// Scripted port
// ---------------------------------------------------------------------------

interface PortOptions {
  failBeginOnCall?: number;
  /** 1-based `begin` call whose first chunk throws (the chatroom is rolled back). */
  failApplyOnBeginCall?: number;
  /** Throws from `preflight` once, before the first entry can begin. */
  preflightError?: unknown;
  /** Aborts after the first chunk of the first entry lands. */
  abortAfterFirstChunk?: AbortController;
}

interface ScriptedPort {
  port: ChatroomImportPort;
  beginCalls: number;
  preflightCalls: number;
  applyCalls: number;
  rollbackCalls: string[];
  calls: string[];
}

function scriptedPort(options: PortOptions = {}): ScriptedPort {
  const state: ScriptedPort = {
    port: undefined as never,
    beginCalls: 0,
    preflightCalls: 0,
    applyCalls: 0,
    rollbackCalls: [],
    calls: [],
  };
  let currentBeginCall = 0;
  let currentChatroomId = '';
  const target: ImportTarget & { hostname: string } = {
    machineId: 'machine-1',
    availableHarnesses: ['opencode-sdk'],
    teamStructureKnown: true,
    invalidWorkingDirs: [],
    hostname: 'host',
  };

  state.port = {
    preflight: async () => {
      state.calls.push('preflight');
      state.preflightCalls += 1;
      if (options.preflightError !== undefined) throw options.preflightError;
      return target;
    },
    begin: async () => {
      state.calls.push('begin');
      state.beginCalls += 1;
      currentBeginCall = state.beginCalls;
      currentChatroomId = `imported-${currentBeginCall}`;
      if (options.failBeginOnCall === currentBeginCall) {
        throw new ChatroomTransferError('BEGIN_FAILED', `begin ${currentBeginCall} failed`);
      }
      return { chatroomId: currentChatroomId };
    },
    applyChunk: async (args) => {
      state.calls.push('applyChunk');
      state.applyCalls += 1;
      if (options.failApplyOnBeginCall === currentBeginCall) {
        throw new Error(`apply failed for ${args.chatroomId}`);
      }
      if (options.abortAfterFirstChunk && state.applyCalls === 1) {
        options.abortAfterFirstChunk.abort();
      }
      if (args.chunk.phase === 'links') return { created: {} };
      return {
        created: Object.fromEntries(args.chunk.rows.map((row) => [row.key, `id-${row.key}`])),
      };
    },
    finalize: async () => {
      state.calls.push('finalize');
    },
    rollback: async (args) => {
      state.calls.push('rollback');
      state.rollbackCalls.push(args.chatroomId);
      return { drained: true, deleted: 0 };
    },
  };
  return state;
}

function statuses(summary: { results: EntryImportResult[] }): string[] {
  return summary.results.map((result) => result.status);
}

function resultFor(summary: { results: EntryImportResult[] }, key: string): EntryImportResult {
  const result = summary.results.find((candidate) => candidate.key === key);
  if (result === undefined) throw new Error(`no result for ${key}`);
  return result;
}

// ---------------------------------------------------------------------------
// Independent imports
// ---------------------------------------------------------------------------

describe('runSelectedImports — independent imports', () => {
  it('imports every selected chatroom in order and counts them', async () => {
    const { listing, keys } = await fixture(2);
    const scripted = scriptedPort();

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(statuses(summary)).toEqual(['imported', 'imported']);
    expect(summary.imported).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(scripted.beginCalls).toBe(2);
  });

  it('keeps the first chatroom when the second begin fails, then still runs the third', async () => {
    const { listing, keys } = await fixture(3);
    const scripted = scriptedPort({ failBeginOnCall: 2 });

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(statuses(summary)).toEqual(['imported', 'failed', 'imported']);
    expect(summary.imported).toBe(2);
    expect(summary.failed).toBe(1);
    expect(resultFor(summary, keys[1])).toMatchObject({ code: BEGIN_FAILED, rolledBack: false });
    expect(scripted.rollbackCalls).toEqual([]);
  });

  it('rolls back only the failing chatroom and never the earlier one', async () => {
    const { listing, keys } = await fixture(2);
    const scripted = scriptedPort({ failApplyOnBeginCall: 2 });

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(statuses(summary)).toEqual(['imported', 'failed']);
    expect(resultFor(summary, keys[1])).toMatchObject({
      code: TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
      rolledBack: true,
    });
    expect(scripted.rollbackCalls).toEqual(['imported-2']);
  });

  it('fails an entry that was listed as not importable without calling the port', async () => {
    const { listing, keys } = await fixture(1);
    const broken: TransferListing = {
      ...listing,
      files: new Map(),
      entries: listing.entries.map((entry) => ({
        ...entry,
        validity: {
          ok: false,
          code: TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
          message: 'tampered',
        },
      })),
    };
    const scripted = scriptedPort();

    const summary = await runSelectedImports(scripted.port, {
      listing: broken,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(resultFor(summary, keys[0])).toMatchObject({
      status: 'failed',
      code: TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
      message: 'tampered',
      rolledBack: false,
    });
    expect(scripted.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Abort and fatal
// ---------------------------------------------------------------------------

describe('runSelectedImports — abort', () => {
  it('marks remaining entries cancelled when the signal aborts between entries', async () => {
    const { listing, keys } = await fixture(3);
    const controller = new AbortController();
    const scripted = scriptedPort();

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'entry-finished') controller.abort();
      },
    });

    expect(statuses(summary)).toEqual(['imported', 'skipped', 'skipped']);
    expect(summary.cancelled).toBe(true);
    expect(summary.skipped).toBe(2);
    expect(scripted.beginCalls).toBe(1);
  });

  it('rolls back only the chatroom in progress, then cancels the rest', async () => {
    const { listing, keys } = await fixture(2);
    const controller = new AbortController();
    const scripted = scriptedPort({ abortAfterFirstChunk: controller });

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
      signal: controller.signal,
    });

    expect(statuses(summary)).toEqual(['failed', 'skipped']);
    expect(resultFor(summary, keys[0])).toMatchObject({
      code: TRANSFER_ERROR_CODES.IMPORT_ROLLED_BACK,
      rolledBack: true,
    });
    expect(scripted.rollbackCalls).toEqual(['imported-1']);
    expect(summary.cancelled).toBe(true);
  });
});

describe('runSelectedImports — target-wide refusal', () => {
  it('stops after the first entry and skips the rest as fatal', async () => {
    const { listing, keys } = await fixture(3);
    const scripted = scriptedPort({
      preflightError: new ChatroomTransferError(
        TRANSFER_ERROR_CODES.IMPORT_MACHINE_NOT_OWNED,
        'machine not owned'
      ),
    });

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(statuses(summary)).toEqual(['failed', 'skipped', 'skipped']);
    expect(summary.fatal).toEqual({
      code: TRANSFER_ERROR_CODES.IMPORT_MACHINE_NOT_OWNED,
      message: 'machine not owned',
    });
    expect(summary.skipped).toBe(2);
    expect(scripted.preflightCalls).toBe(1);
    expect(summary.results.slice(1).every((result) => result.status === 'skipped')).toBe(true);
  });

  it('reads a Convex-style data.code as the target-wide code', async () => {
    const { listing, keys } = await fixture(1);
    const scripted = scriptedPort({ preflightError: { data: { code: AUTH_FAILED } } });

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
    });

    expect(resultFor(summary, keys[0])).toMatchObject({ status: 'failed', code: AUTH_FAILED });
    expect(summary.fatal).toEqual({ code: AUTH_FAILED, message: '[object Object]' });
  });
});

// ---------------------------------------------------------------------------
// Dry run and events
// ---------------------------------------------------------------------------

describe('runSelectedImports — dry run', () => {
  it('runs preflight per entry and makes zero write calls', async () => {
    const { listing, keys } = await fixture(2);
    const scripted = scriptedPort();

    const summary = await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: true,
    });

    expect(statuses(summary)).toEqual(['dry-run', 'dry-run']);
    expect(scripted.preflightCalls).toBe(2);
    expect(scripted.beginCalls).toBe(0);
    expect(scripted.applyCalls).toBe(0);
  });

  it('emits started, created, chunk progress and finished events per entry', async () => {
    const { listing, keys } = await fixture(1);
    const scripted = scriptedPort();
    const events: ImportRunEvent[] = [];

    await runSelectedImports(scripted.port, {
      listing,
      keys,
      machineId: 'machine-1',
      dryRun: false,
      onEvent: (event) => events.push(event),
    });

    expect(events[0]).toEqual({ type: 'entry-started', key: keys[0], index: 1, total: 1 });
    expect(events.some((event) => event.type === 'chatroom-created')).toBe(true);
    expect(events.some((event) => event.type === 'chunk-applied')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'entry-finished', key: keys[0] });
  });
});
