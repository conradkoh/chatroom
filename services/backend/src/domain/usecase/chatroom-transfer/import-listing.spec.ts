/**
 * Offline listing and selection.
 *
 * The fixtures are real exports built by `runExport` and `runExportBundle`
 * through a fake export port, so the payload checksums, the bundle checksum and
 * the index pairing are produced by the same code that writes a real file. The
 * tests never compute an expected checksum themselves: they tamper with one
 * field and assert the pairing/checksum rules catch it.
 *
 * This seam proves the fixed refusal order, that a single-chatroom file is
 * refused whole as `IMPORT_NOT_AN_EXPORT`, that a bundle entry only marks itself
 * `not importable`, and the selection token rules. It does not render CLI
 * output.
 */

import { describe, expect, it } from 'vitest';

import { runExportBundle } from './export-bundle';
import { runExport, type ChatroomExportPort } from './export-driver';
import type { ExportRawRow, ExportStamp } from './export-read';
import {
  checkTransferFileSize,
  parseTransferFile,
  selectEntries,
  type TransferListing,
} from './import-listing';
import { TRANSFER_ERROR_CODES, type ExportCategory } from '../../entities/chatroom-transfer-file';

const NOW = '2026-05-01T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures: real exports over a fake export port
// ---------------------------------------------------------------------------

function rawRow(id: string, creationTime: number, fields: Record<string, unknown>): ExportRawRow {
  return { id, creationTime, fields };
}

function rawRows(
  roomId: string,
  name: string,
  messageContents: readonly string[]
): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [rawRow('room1', 1, { name, status: 'active', teamStructureId: 'trio@1' })],
    workspaces: [
      rawRow('ws1', 2, {
        workingDir: `/repo/${roomId}`,
        machineId: 'm',
        fileTreeSyncEnabled: true,
      }),
    ],
    agentConfigs: [],
    messages: messageContents.map((content, index) =>
      rawRow(`msg${index}`, 10 + index, { senderRole: 'user', content, type: 'message' })
    ),
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

/** Answers each chatroom id with its own rows, so a bundle holds distinct payloads. */
function portFor(
  rooms: Record<string, Record<ExportCategory, ExportRawRow[]>>
): ChatroomExportPort {
  return {
    getStamp: async () => emptyStamp(),
    readPage: async ({ chatroomId, category }) => ({
      rows: rooms[chatroomId]?.[category] ?? [],
      continueCursor: null,
      isDone: true,
    }),
  };
}

async function singleFile(name = 'Source room'): Promise<string> {
  const { json } = await runExport(portFor({ roomA: rawRows('roomA', name, ['hello']) }), {
    chatroomId: 'roomA',
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return json;
}

async function bundleFile(): Promise<string> {
  const rooms = {
    roomA: rawRows('roomA', 'Room A', ['a1', 'a2']),
    roomB: rawRows('roomB', 'Room B', ['b1']),
  };
  const { json } = await runExportBundle(portFor(rooms), {
    chatroomIds: ['roomA', 'roomB'],
    machineId: 'machine-1',
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return json;
}

function parsed(json: string): {
  kind: string;
  index: { sourceChatroomId: string; checksum: string }[];
  chatrooms: Record<string, unknown>[];
  checksum: string;
} {
  return JSON.parse(json) as never;
}

type ParsedBundle = ReturnType<typeof parsed>;

function rewrite(json: string, change: (bundle: ParsedBundle) => void): string {
  const bundle = parsed(json);
  change(bundle);
  return JSON.stringify(bundle);
}

function tamperChecksum(json: string): string {
  return rewrite(json, (bundle) => {
    const last = bundle.checksum.slice(-1);
    bundle.checksum = `${bundle.checksum.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  });
}

async function listingOf(json: string): Promise<TransferListing> {
  const result = await parseTransferFile(json);
  if (!result.ok) throw new Error(`expected a listing, got ${result.code}`);
  return result.listing;
}

// ---------------------------------------------------------------------------
// Whole-file refusals
// ---------------------------------------------------------------------------

describe('parseTransferFile — whole-file refusals', () => {
  it('refuses invalid JSON with IMPORT_FILE_UNREADABLE first', async () => {
    expect(await parseTransferFile('{')).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      message: 'The file is not valid JSON.',
    });
  });

  it('refuses a non-export object with IMPORT_NOT_AN_EXPORT', async () => {
    expect(await parseTransferFile('{"formatVersion":1,"kind":"something-else"}')).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_NOT_AN_EXPORT,
      message: 'This file is not a chatroom export.',
    });
  });

  it('refuses a valid single-chatroom file as no longer importable, naming the machine export', async () => {
    expect(await parseTransferFile(await singleFile('Room A'))).toEqual({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_NOT_AN_EXPORT,
      message:
        'This file is a single-chatroom export, which can no longer be imported. Import a machine export (chatroom-all-<machine>-<time>.json) instead.',
      details: [],
    });
  });

  it('checks the kind before the version, so a single file with a bad version is still IMPORT_NOT_AN_EXPORT', async () => {
    const v2 = rewrite(await singleFile(), (file) => {
      (file as unknown as { formatVersion: number }).formatVersion = 2;
    });

    expect(await parseTransferFile(v2)).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_NOT_AN_EXPORT,
    });
  });
});

// ---------------------------------------------------------------------------
// Bundle entries
// ---------------------------------------------------------------------------

describe('parseTransferFile — bundle', () => {
  it('lists every chatroom in index order with its counts and names', async () => {
    const listing = await listingOf(await bundleFile());

    expect(listing.exportedAt).toBe(NOW);
    expect(listing.entries.map((entry) => entry.key)).toEqual(['roomA', 'roomB']);
    expect(listing.entries.map((entry) => entry.position)).toEqual([1, 2]);
    expect(listing.entries.map((entry) => entry.name)).toEqual(['Room A', 'Room B']);
    expect(listing.entries.map((entry) => entry.counts?.messages)).toEqual([2, 1]);
    expect([...listing.files.keys()]).toEqual(['roomA', 'roomB']);
  });

  it('reports progress once per entry with the entry total', async () => {
    const calls: [number, number][] = [];

    await parseTransferFile(await bundleFile(), {
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('refuses a bundle whose index checksum does not match, before listing entries', async () => {
    expect(await parseTransferFile(tamperChecksum(await bundleFile()))).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
      message: 'The bundle index does not match its checksum; the file changed after export.',
    });
  });

  it('refuses a bundle with a bad version with IMPORT_UNSUPPORTED_VERSION', async () => {
    const v2 = rewrite(await bundleFile(), (bundle) => {
      (bundle as unknown as { formatVersion: number }).formatVersion = 2;
    });

    expect(await parseTransferFile(v2)).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_UNSUPPORTED_VERSION,
      message: 'This export file has format version 2; this app reads version 1.',
    });
  });

  it('lists a one-entry bundle and selects it like any other bundle', async () => {
    const { json } = await runExportBundle(
      portFor({ roomA: rawRows('roomA', 'Room A', ['hello']) }),
      {
        chatroomIds: ['roomA'],
        machineId: 'machine-1',
        cliVersion: 'test',
        now: () => new Date(NOW),
      }
    );
    const listing = await listingOf(json);

    expect(listing.entries.map((entry) => entry.key)).toEqual(['roomA']);
    expect(selectEntries(listing, 'all')).toEqual({ ok: true, keys: ['roomA'] });
    expect(selectEntries(listing, ['1'])).toEqual({ ok: true, keys: ['roomA'] });
  });

  it('refuses a bundle whose index and chatrooms have different lengths', async () => {
    const broken = rewrite(await bundleFile(), (bundle) => {
      bundle.index.pop();
    });

    expect(await parseTransferFile(broken)).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      message: 'The file is not a readable chatroom export bundle.',
    });
  });

  it('refuses a bundle whose index ids are not unique', async () => {
    const broken = rewrite(await bundleFile(), (bundle) => {
      bundle.index[1].sourceChatroomId = 'roomA';
    });

    expect(await parseTransferFile(broken)).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
    });
  });

  it('lists a tampered payload as not importable and keeps the other entry valid', async () => {
    const tampered = rewrite(await bundleFile(), (bundle) => {
      const payload = bundle.chatrooms[0] as { room: { name: string } };
      payload.room.name = 'Tampered after export';
    });
    const listing = await listingOf(tampered);

    expect(listing.entries[0]).toMatchObject({
      key: 'roomA',
      name: 'Room A',
      validity: { ok: false, code: TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH },
    });
    expect(listing.entries[1].validity).toEqual({ ok: true });
    expect([...listing.files.keys()]).toEqual(['roomB']);
  });

  it('marks both entries not importable when two payloads are swapped', async () => {
    const swapped = rewrite(await bundleFile(), (bundle) => {
      bundle.chatrooms.reverse();
    });
    const listing = await listingOf(swapped);

    expect(listing.entries.map((entry) => entry.validity.ok)).toEqual([false, false]);
    expect(listing.files.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('selectEntries', () => {
  async function validListing(): Promise<TransferListing> {
    return await listingOf(await bundleFile());
  }

  it('selects by source id', async () => {
    const listing = await validListing();

    expect(selectEntries(listing, ['roomB'])).toEqual({ ok: true, keys: ['roomB'] });
  });

  it('selects by 1-based position and drops duplicates', async () => {
    const listing = await validListing();

    expect(selectEntries(listing, ['1', 'roomA', '2'])).toEqual({
      ok: true,
      keys: ['roomA', 'roomB'],
    });
  });

  it('reports every unknown token together', async () => {
    const listing = await validListing();

    expect(selectEntries(listing, ['9', 'nope'])).toEqual({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_SELECTION_INVALID,
      message: 'Unknown or not importable chatroom selection: 9, nope',
      details: ['9', 'nope'],
    });
  });

  it('refuses an entry that was listed as not importable', async () => {
    const tampered = rewrite(await bundleFile(), (bundle) => {
      const payload = bundle.chatrooms[0] as { room: { name: string } };
      payload.room.name = 'Tampered';
    });
    const listing = await listingOf(tampered);

    expect(selectEntries(listing, ['roomA'])).toMatchObject({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_SELECTION_INVALID,
      details: ['roomA'],
    });
  });

  it("selects every importable entry for 'all' and silently skips invalid ones", async () => {
    const tampered = rewrite(await bundleFile(), (bundle) => {
      const payload = bundle.chatrooms[0] as { room: { name: string } };
      payload.room.name = 'Tampered';
    });
    const listing = await listingOf(tampered);

    expect(selectEntries(listing, 'all')).toEqual({ ok: true, keys: ['roomB'] });
  });
});

// ---------------------------------------------------------------------------
// Size gate
// ---------------------------------------------------------------------------

describe('checkTransferFileSize', () => {
  it('refuses one byte over the limit', () => {
    expect(checkTransferFileSize(268_435_457)).toEqual({
      ok: false,
      code: TRANSFER_ERROR_CODES.IMPORT_FILE_TOO_LARGE,
      message: 'file is larger than 268435456 bytes',
      details: [],
    });
  });

  it('accepts exactly the limit', () => {
    expect(checkTransferFileSize(268_435_456)).toBeNull();
  });
});
