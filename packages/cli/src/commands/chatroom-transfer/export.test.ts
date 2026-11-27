/**
 * `exportChatroom` tests.
 *
 * The Convex transport is substituted at `BackendOps`, the session at
 * `SessionOps`, and the file system at `ChatroomTransferFs`; the real
 * `runExport` driver and `buildExportFile` run against canned stamps and pages.
 * Failures are rendered by the same `[CODE] message` + `exit(1)` contract that
 * `register.ts` applies.
 */

import { join } from 'node:path';

import {
  ChatroomTransferError,
  TRANSFER_ERROR_CODES,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type {
  ExportPage,
  ExportRawRow,
  ExportStamp,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-read';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import type { ChatroomTransferDeps, ChatroomTransferFs } from './deps.js';
import { exportChatroom, formatTransferError } from './export.js';
import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/** The clock both the file's `exportedAt` and its name use. */
const NOW = '2026-11-25T13:04:05Z';
const NAME = 'chatroom-abc-20261125T130405Z.json';
const WARNING =
  'warning: this file is plaintext and contains conversation content. Keep it private.';
/** The ignore file the default exports directory gets. */
const GITIGNORE = join('/work', '.chatroom', 'exports', '.gitignore');

const ALL_CATEGORIES: readonly ExportCategory[] = [
  'room',
  'workspaces',
  'agentConfigs',
  'messages',
  'messageQueue',
  'tasks',
  'backlog',
  'artifacts',
  'contexts',
  'scheduledPrompts',
  'savedCommands',
  'skillCustomizations',
];

/** A stamp that matches an untouched, attachment-free chatroom. */
function defaultStamp(overrides: Partial<ExportStamp> = {}): ExportStamp {
  return {
    attachmentRows: { count: 0, capped: false, totalBytes: 0 },
    lastActivityAt: 1,
    nextQueuePosition: 1,
    latestMessage: null,
    taskCounts: null,
    latest: {},
    ...overrides,
  };
}

/** The one room row the export needs; `teamStructureId` filters launch requests. */
function defaultRoom(): ExportRawRow {
  return {
    id: 'room1',
    creationTime: 1,
    fields: { name: 'Test chatroom', status: 'active', teamStructureId: 'ts1' },
  };
}

interface RecordedQuery {
  endpoint: unknown;
  args: unknown;
}

interface FakeBackend {
  backend: BackendOps;
  queries: RecordedQuery[];
  /** Exports started per chatroom; a retry counts separately, a second stamp read does not. */
  attempts: (chatroomId: string) => number;
}

/**
 * A transport fake. The endpoint is `anyApi`, so its proxies are not identity
 * comparable; the call's argument shape identifies the query instead: only the
 * list query carries a `machineId`, only `readPage` carries a `category`, and a
 * stamp carries only a `chatroomId`. `stamps` is consumed in order (the driver
 * reads the stamp first and last); every read after the last entry repeats it.
 * `attachmentChatroomIds` answers every stamp with one 5-byte attachment row for
 * those ids. `changedChatroomIds` answers the first stamp unchanged and every
 * later one with a different activity value, so the export detects a change on
 * every attempt. `transientChatroomIds` fail the first page read once, so a
 * retry succeeds. `failingChatroomIds` fail every page read, so both attempts
 * fail. `tooLargeChatroomIds` fail the first stamp with `EXPORT_TOO_LARGE`,
 * which is never retried.
 */
function createFakeBackend(
  options: {
    stamps?: ExportStamp[];
    room?: ExportRawRow;
    rooms?: ExportableChatroom[] | undefined;
    attachmentChatroomIds?: readonly string[] | undefined;
    changedChatroomIds?: readonly string[] | undefined;
    transientChatroomIds?: readonly string[] | undefined;
    failingChatroomIds?: readonly string[] | undefined;
    tooLargeChatroomIds?: readonly string[] | undefined;
  } = {}
): FakeBackend {
  const stamps = options.stamps ?? [defaultStamp()];
  const room = options.room ?? defaultRoom();
  const rooms = options.rooms ?? [];
  const attachmentChatroomIds = options.attachmentChatroomIds ?? [];
  const changedChatroomIds = options.changedChatroomIds ?? [];
  const transientChatroomIds = new Set(options.transientChatroomIds ?? []);
  const failingChatroomIds = options.failingChatroomIds ?? [];
  const tooLargeChatroomIds = options.tooLargeChatroomIds ?? [];
  const queries: RecordedQuery[] = [];
  const chatroomStampReads = new Map<string, number>();
  const attempts = new Map<string, number>();
  const attemptActive = new Set<string>();
  let stampReads = 0;

  const startAttempt = (chatroomId: string): void => {
    if (attemptActive.has(chatroomId)) return;
    attempts.set(chatroomId, (attempts.get(chatroomId) ?? 0) + 1);
    attemptActive.add(chatroomId);
  };

  const failPage = (chatroomId: string, message: string): never => {
    attemptActive.delete(chatroomId);
    throw new Error(message);
  };

  const backend: BackendOps = {
    mutation: async () => {
      throw new Error('chatroom export must not call a mutation');
    },
    query: async (endpoint: unknown, args: unknown) => {
      queries.push({ endpoint, args });
      const read = args as {
        chatroomId?: string;
        category?: ExportCategory;
        machineId?: string;
      };
      if (read.machineId !== undefined) return rooms;
      if (read.category !== undefined) {
        if (read.chatroomId !== undefined && transientChatroomIds.has(read.chatroomId)) {
          transientChatroomIds.delete(read.chatroomId);
          failPage(read.chatroomId, 'injected: transient page failure');
        }
        if (read.chatroomId !== undefined && failingChatroomIds.includes(read.chatroomId)) {
          failPage(read.chatroomId, 'injected: page failure');
        }
        return pageFor({ category: read.category }, room);
      }
      if (read.chatroomId !== undefined) startAttempt(read.chatroomId);
      if (read.chatroomId !== undefined && tooLargeChatroomIds.includes(read.chatroomId)) {
        throw new ChatroomTransferError(
          TRANSFER_ERROR_CODES.EXPORT_TOO_LARGE,
          'Export exceeds the 1000-byte limit; remove content and run the export again.'
        );
      }
      if (read.chatroomId !== undefined && attachmentChatroomIds.includes(read.chatroomId)) {
        return defaultStamp({ attachmentRows: { count: 1, capped: false, totalBytes: 5 } });
      }
      if (read.chatroomId !== undefined && changedChatroomIds.includes(read.chatroomId)) {
        const reads = (chatroomStampReads.get(read.chatroomId) ?? 0) + 1;
        chatroomStampReads.set(read.chatroomId, reads);
        return reads === 1 ? defaultStamp() : defaultStamp({ lastActivityAt: 2 });
      }
      const stamp = stamps[Math.min(stampReads, stamps.length - 1)];
      stampReads += 1;
      return stamp;
    },
  };
  return { backend, queries, attempts: (chatroomId) => attempts.get(chatroomId) ?? 0 };
}

function pageFor(args: { category: ExportCategory }, room: ExportRawRow): ExportPage {
  return args.category === 'room'
    ? { rows: [room], continueCursor: null, isDone: true }
    : { rows: [], continueCursor: null, isDone: true };
}

/** In-memory fs with the same no-overwrite contract as the node adapter. */
class RecordingFs implements ChatroomTransferFs {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  readonly dirs: { path: string; mode: number }[] = [];
  readonly writes: { path: string; data: string; mode: number }[] = [];

  async mkdirp(path: string, mode: number): Promise<void> {
    this.calls.push(`mkdirp:${path}`);
    this.dirs.push({ path, mode });
  }

  async writeExclusive(path: string, data: string, mode: number): Promise<void> {
    this.calls.push(`write:${path}`);
    if (this.files.has(path)) throw errnoError('EEXIST');
    this.writes.push({ path, data, mode });
    this.files.set(path, data);
  }

  async link(existing: string, newPath: string): Promise<void> {
    this.calls.push(`link:${newPath}`);
    if (this.files.has(newPath)) throw errnoError('EEXIST');
    const data = this.files.get(existing);
    if (data === undefined) throw errnoError('ENOENT');
    this.files.set(newPath, data);
  }

  async unlink(path: string): Promise<void> {
    this.calls.push(`unlink:${path}`);
    this.files.delete(path);
  }

  async readFile(path: string): Promise<string> {
    return this.files.get(path) ?? '';
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    const data = this.files.get(path);
    return { isFile: data !== undefined, isDirectory: false, size: data?.length ?? 0 };
  }
}

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface Harness {
  deps: ChatroomTransferDeps;
  out: string[];
  err: string[];
  exits: number[];
  fs: RecordingFs;
  queries: RecordedQuery[];
  attempts: (chatroomId: string) => number;
}

function createHarness(
  options: {
    cwd?: string;
    sessionId?: string | null;
    machineId?: string | null;
    backend?: FakeBackend;
    fs?: RecordingFs;
    rooms?: ExportableChatroom[];
    attachmentChatroomIds?: readonly string[];
    changedChatroomIds?: readonly string[];
    transientChatroomIds?: readonly string[];
    failingChatroomIds?: readonly string[];
    tooLargeChatroomIds?: readonly string[];
  } = {}
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const fs = options.fs ?? new RecordingFs();
  const fake =
    options.backend ??
    createFakeBackend({
      rooms: options.rooms,
      attachmentChatroomIds: options.attachmentChatroomIds,
      changedChatroomIds: options.changedChatroomIds,
      transientChatroomIds: options.transientChatroomIds,
      failingChatroomIds: options.failingChatroomIds,
      tooLargeChatroomIds: options.tooLargeChatroomIds,
    });
  const sessionId = options.sessionId === undefined ? 'session-abc' : options.sessionId;
  const machineId = options.machineId === undefined ? 'machine-1' : options.machineId;

  const session: SessionOps = {
    getSessionId: async () => (sessionId === null ? null : (sessionId as SessionId)),
    getConvexUrl: () => 'https://example.test',
    getOtherSessionUrls: async () => [],
  };
  const cwd = options.cwd ?? '/work';
  const deps: ChatroomTransferDeps = {
    backend: fake.backend,
    session,
    machine: { getMachineId: async () => machineId },
    fs,
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
    signals: { on: () => {}, off: () => {} },
  };
  return { deps, out, err, exits, fs, queries: fake.queries, attempts: fake.attempts };
}

/** Runs the command body with the wrapper `register.ts` applies around it. */
async function runExport(
  opts: { chatroomId?: string; all?: boolean; path?: string | undefined },
  deps: ChatroomTransferDeps
): Promise<void> {
  try {
    await exportChatroom(opts, deps);
  } catch (error) {
    const formatted = formatTransferError(error);
    deps.err(`❌ [${formatted.code}] ${formatted.message}`);
    deps.exit(1);
  }
}

describe('exportChatroom (success)', () => {
  it('writes one file under <cwd>/.chatroom/exports and prints the report', async () => {
    const h = createHarness({ cwd: '/work' });

    await runExport({ chatroomId: 'abc' }, h.deps);

    const final = join('/work', '.chatroom', 'exports', NAME);
    expect(h.fs.files.has(final)).toBe(true);
    expect(JSON.parse(h.fs.files.get(final) ?? '{}')).toMatchObject({
      formatVersion: 1,
      kind: 'chatroom-export',
      source: { chatroomId: 'abc', cliVersion: '1.0.0-test' },
      room: { _key: 'r0', name: 'Test chatroom' },
    });
    expect(h.out[0]).toBe('Exported chatroom abc');
    expect(h.out[1]).toBe(`  file: ${final}`);
    expect(h.out).toContain('  counts:');
    for (const category of ALL_CATEGORIES) {
      expect(h.out).toContain(`    ${category}: ${category === 'room' ? 1 : 0}`);
    }
    expect(h.out).toContain('  omitted (not in file):');
    expect(h.out).toContain(
      '    workspace_caches: Workspace caches are rebuilt by the target daemon.'
    );
    expect(h.out).not.toContain('    chatroom_workspaceGitState:');
    expect(h.out.at(-1)).toBe(WARNING);
    expect(h.err).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('resolves a relative --path against cwd', async () => {
    const h = createHarness({ cwd: '/work' });

    await runExport({ chatroomId: 'abc', path: 'custom/dir' }, h.deps);

    expect(h.fs.files.has(join('/work', 'custom', 'dir', NAME))).toBe(true);
  });

  it('exports a chatroom with an attachment and reports it as not included', async () => {
    const backend = createFakeBackend({
      stamps: [defaultStamp({ attachmentRows: { count: 1, capped: false, totalBytes: 5 } })],
    });
    const h = createHarness({ cwd: '/work', backend });

    await runExport({ chatroomId: 'abc' }, h.deps);

    const final = join('/work', '.chatroom', 'exports', NAME);
    expect(h.fs.files.has(final)).toBe(true);
    expect(h.out).toContain('1 attachment(s) not included (5 B)');
    expect(h.out.at(-1)).toBe(WARNING);
    expect(h.err).toEqual([]);
    expect(h.exits).toEqual([]);
  });
});

describe('exportChatroom (default exports directory)', () => {
  it('writes a ".gitignore" containing "*" into the default directory', async () => {
    const h = createHarness({ cwd: '/work' });

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.fs.files.get(GITIGNORE)).toBe('*\n');
    expect(h.fs.writes).toContainEqual({ path: GITIGNORE, data: '*\n', mode: 0o644 });
    expect(h.fs.files.has(join('/work', '.chatroom', 'exports', NAME))).toBe(true);
  });

  it('writes no ignore file for a custom --path', async () => {
    const h = createHarness({ cwd: '/work' });

    await runExport({ chatroomId: 'abc', path: 'custom/dir' }, h.deps);

    const customIgnore = join('/work', 'custom', 'dir', '.gitignore');
    expect(h.fs.files.has(customIgnore)).toBe(false);
    expect(h.fs.writes.map((write) => write.path)).not.toContain(customIgnore);
  });

  it('preserves an existing .gitignore in the default directory', async () => {
    const h = createHarness({ cwd: '/work' });
    h.fs.files.set(GITIGNORE, 'custom\n');

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.fs.files.get(GITIGNORE)).toBe('custom\n');
    expect(h.fs.calls).toContain(`write:${GITIGNORE}`);
    expect(h.fs.files.has(join('/work', '.chatroom', 'exports', NAME))).toBe(true);
  });
});

describe('exportChatroom (refusals)', () => {
  it('refuses when the stamp changes between the first and second read', async () => {
    const backend = createFakeBackend({
      stamps: [defaultStamp(), defaultStamp({ lastActivityAt: 2 })],
    });
    const h = createHarness({ cwd: '/work', backend });

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain('❌ [EXPORT_CHATROOM_CHANGED]');
    expect(h.exits).toEqual([1]);
    expect(h.fs.files.size).toBe(0);
  });

  it('a failed export creates no default directory and no ignore file', async () => {
    const backend = createFakeBackend({
      stamps: [defaultStamp(), defaultStamp({ lastActivityAt: 2 })],
    });
    const h = createHarness({ cwd: '/work', backend });

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.err[0]).toContain('❌ [EXPORT_CHATROOM_CHANGED]');
    expect(h.exits).toEqual([1]);
    expect(h.fs.dirs).toEqual([]);
    expect(h.fs.files.size).toBe(0);
  });

  it('reports a file-name collision and keeps the existing file', async () => {
    const h = createHarness({ cwd: '/work' });
    const final = join('/work', '.chatroom', 'exports', NAME);
    h.fs.files.set(final, 'previous');

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.err[0]).toContain('❌ [EXPORT_FILE_EXISTS]');
    expect(h.exits).toEqual([1]);
    expect(h.fs.files.get(final)).toBe('previous');
  });

  it('exits 1 without calling the backend when there is no session', async () => {
    const h = createHarness({ sessionId: null });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await runExport({ chatroomId: 'abc' }, h.deps);

      const written = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(written).toContain('https://example.test');
      expect(written).toContain('chatroom auth login');
      expect(h.exits).toEqual([1]);
    } finally {
      errorSpy.mockRestore();
    }
    expect(h.queries).toEqual([]);
    expect(h.fs.calls).toEqual([]);
  });
});

/** `chatroom-<id>-20261125T130405Z.json`, the per-chatroom name `--all` no longer writes. */
function exportName(chatroomId: string): string {
  return `chatroom-${chatroomId}-20261125T130405Z.json`;
}

/** `chatroom-all-<machine>-20261125T130405Z.json`, the one file `--all` writes. */
const BUNDLE_NAME = 'chatroom-all-machine-1-20261125T130405Z.json';

/** The rooms the `--all` cases export, in list order. */
function rooms(...ids: string[]): ExportableChatroom[] {
  return ids.map((chatroomId) => ({
    chatroomId: chatroomId as ExportableChatroom['chatroomId'],
    name: null,
    status: 'active',
  }));
}

/** How many stamps were read for a chatroom; EXPORT_TOO_LARGE is visible here. */
function stampReads(queries: readonly RecordedQuery[], chatroomId: string): number {
  return queries.filter((query) => {
    const args = query.args as { chatroomId?: string; category?: string; machineId?: string };
    return (
      args.chatroomId === chatroomId && args.category === undefined && args.machineId === undefined
    );
  }).length;
}

describe('exportChatroom (--all)', () => {
  it('refuses when neither --chatroom-id nor --all is given', async () => {
    const h = createHarness();

    const error: unknown = await exportChatroom({}, h.deps).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe(TRANSFER_ERROR_CODES.EXPORT_TARGET_REQUIRED);
    expect(h.queries).toEqual([]);
    expect(h.fs.calls).toEqual([]);
  });

  it('refuses --all together with --chatroom-id', async () => {
    const h = createHarness();

    const error: unknown = await exportChatroom({ all: true, chatroomId: 'c1' }, h.deps).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe(TRANSFER_ERROR_CODES.EXPORT_TARGET_CONFLICT);
    expect(h.queries).toEqual([]);
  });

  it('refuses --all when the machine has no identity', async () => {
    const h = createHarness({ machineId: null, rooms: rooms('c1') });

    const error: unknown = await exportChatroom({ all: true }, h.deps).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe(
      TRANSFER_ERROR_CODES.EXPORT_NO_MACHINE_IDENTITY
    );
    expect(
      h.queries.some((query) => (query.args as { machineId?: string }).machineId !== undefined)
    ).toBe(false);
    expect(h.fs.calls).toEqual([]);
  });

  it('writes exactly one bundle in list order and prints one summary', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2') });

    await exportChatroom({ all: true }, h.deps);

    const final = join('/work', '.chatroom', 'exports', BUNDLE_NAME);
    expect(h.fs.files.has(final)).toBe(true);
    expect(h.fs.files.has(join('/work', '.chatroom', 'exports', exportName('c1')))).toBe(false);

    const bundle = JSON.parse(h.fs.files.get(final) ?? '{}') as {
      kind: string;
      index: { sourceChatroomId: string; checksum: string }[];
      chatrooms: { source: { chatroomId: string }; checksum: string }[];
    };
    expect(bundle.kind).toBe('chatroom-export-bundle');
    expect(bundle.index.map((entry) => entry.sourceChatroomId)).toEqual(['c1', 'c2']);
    expect(bundle.chatrooms.map((file) => file.source.chatroomId)).toEqual(['c1', 'c2']);
    for (const [i, entry] of bundle.index.entries()) {
      expect(entry.checksum).toBe(bundle.chatrooms[i].checksum);
    }

    expect(h.out.filter((line) => line.startsWith('  file: '))).toEqual([`  file: ${final}`]);
    expect(h.out.some((line) => line.startsWith('Exported chatroom '))).toBe(false);
    expect(h.out).toContain('Exported 2 chatrooms from machine machine-1');
    expect(h.out.some((line) => line.startsWith('  size: '))).toBe(true);
    expect(h.out.at(-1)).toBe(WARNING);
    expect(h.out.filter((line) => line === WARNING)).toHaveLength(1);
    expect(h.err).toEqual([]);
    expect(h.exits).toEqual([]);

    const bundleWrites = h.fs.writes.filter((write) => write.path.includes(BUNDLE_NAME));
    expect(bundleWrites).toHaveLength(1);
    expect(bundleWrites[0]?.mode).toBe(0o600);
    expect([...h.fs.files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false);
  });

  it('writes nothing and reports when the machine has no chatrooms', async () => {
    const h = createHarness({ rooms: [] });

    await exportChatroom({ all: true }, h.deps);

    expect(h.out).toEqual(['No chatrooms found for machine machine-1 that you own.']);
    expect(h.fs.calls).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('retries a chatroom once and writes the bundle when the retry succeeds', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2'), transientChatroomIds: ['c2'] });

    await exportChatroom({ all: true }, h.deps);

    expect(h.fs.files.has(join('/work', '.chatroom', 'exports', BUNDLE_NAME))).toBe(true);
    expect(h.err).toEqual([]);
    expect(h.exits).toEqual([]);
    expect(h.attempts('c2')).toBe(2);
    expect(h.attempts('c1')).toBe(1);
  });

  it('writes no file and reports every chatroom that failed twice', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2', 'c3'), failingChatroomIds: ['c2'] });

    await runExport({ all: true }, h.deps);

    expect(h.err[0]).toMatch(/^❌ \[EXPORT_ALL_INCOMPLETE\] c2: \[UNKNOWN\] injected: /);
    expect(h.err[1]).toMatch(/^❌ \[EXPORT_ALL_INCOMPLETE\] exported 2 of 3 chatrooms; 1 failed/);
    expect(h.exits).toEqual([1]);
    expect(h.fs.files.size).toBe(0);
    expect(h.fs.calls).toEqual([]);
    expect(h.attempts('c2')).toBe(2);
    expect(h.out).not.toContain(WARNING);
  });

  it('does not retry EXPORT_TOO_LARGE and fails the run', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2'), tooLargeChatroomIds: ['c2'] });

    const error: unknown = await exportChatroom({ all: true }, h.deps).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe(TRANSFER_ERROR_CODES.EXPORT_TOO_LARGE);
    expect(stampReads(h.queries, 'c2')).toBe(1);
    expect(h.fs.files.size).toBe(0);
  });

  it('prints the size and one attachment line in the summary', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2'), attachmentChatroomIds: ['c1'] });

    await exportChatroom({ all: true }, h.deps);

    expect(h.out.some((line) => line.startsWith('  size: '))).toBe(true);
    expect(h.out.filter((line) => line.includes('attachment(s) not included'))).toEqual([
      '1 attachment(s) not included (5 B)',
    ]);
    expect(h.out.filter((line) => line === WARNING)).toHaveLength(1);
  });

  it('--path is used for the bundle and writes no ignore file', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2') });

    await exportChatroom({ all: true, path: 'custom/out' }, h.deps);

    expect(h.fs.files.has(join('/work', 'custom', 'out', BUNDLE_NAME))).toBe(true);
    expect(h.fs.writes.map((write) => write.path).some((path) => path.endsWith('.gitignore'))).toBe(
      false
    );
  });

  it('the default directory gets one ignore file for the whole run', async () => {
    const h = createHarness({ rooms: rooms('c1', 'c2') });

    await exportChatroom({ all: true }, h.deps);

    const ignoreWrites = h.fs.writes.filter((write) => write.path.endsWith('.gitignore'));
    expect(ignoreWrites).toHaveLength(1);
    expect(ignoreWrites[0]?.data).toBe('*\n');
  });

  it('refuses to overwrite an existing bundle and keeps it', async () => {
    const h = createHarness({ rooms: rooms('c1') });
    const final = join('/work', '.chatroom', 'exports', BUNDLE_NAME);
    h.fs.files.set(final, 'previous');

    await runExport({ all: true }, h.deps);

    expect(h.err[0]).toContain('❌ [EXPORT_FILE_EXISTS]');
    expect(h.exits).toEqual([1]);
    expect(h.fs.files.get(final)).toBe('previous');
  });
});
