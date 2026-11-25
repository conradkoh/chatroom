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

import type { ExportCategory } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
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
    attachmentRows: { count: 0, capped: false },
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
}

/**
 * A transport fake. The endpoint is `anyApi`, so its proxies are not identity
 * comparable; the call's argument shape identifies the query instead: only
 * `readPage` carries a `category`. `stamps` is consumed in order (the driver
 * reads the stamp first and last); every read after the last entry repeats it.
 */
function createFakeBackend(
  options: { stamps?: ExportStamp[]; room?: ExportRawRow } = {}
): FakeBackend {
  const stamps = options.stamps ?? [defaultStamp()];
  const room = options.room ?? defaultRoom();
  const queries: RecordedQuery[] = [];
  let stampReads = 0;

  const backend: BackendOps = {
    mutation: async () => {
      throw new Error('chatroom export must not call a mutation');
    },
    query: async (endpoint: unknown, args: unknown) => {
      queries.push({ endpoint, args });
      const read = args as { category?: ExportCategory };
      if (read.category !== undefined) return pageFor({ category: read.category }, room);
      const stamp = stamps[Math.min(stampReads, stamps.length - 1)];
      stampReads += 1;
      return stamp;
    },
  };
  return { backend, queries };
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
}

function createHarness(
  options: {
    cwd?: string;
    sessionId?: string | null;
    backend?: FakeBackend;
    fs?: RecordingFs;
  } = {}
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const fs = options.fs ?? new RecordingFs();
  const fake = options.backend ?? createFakeBackend();
  const sessionId = options.sessionId === undefined ? 'session-abc' : options.sessionId;

  const session: SessionOps = {
    getSessionId: async () => (sessionId === null ? null : (sessionId as SessionId)),
    getConvexUrl: () => 'https://example.test',
    getOtherSessionUrls: async () => [],
  };
  const cwd = options.cwd ?? '/work';
  const deps: ChatroomTransferDeps = {
    backend: fake.backend,
    session,
    machine: { getMachineId: async () => 'machine-1' },
    fs,
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
    signals: { on: () => {}, off: () => {} },
  };
  return { deps, out, err, exits, fs, queries: fake.queries };
}

/** Runs the command body with the wrapper `register.ts` applies around it. */
async function runExport(
  opts: { chatroomId: string; path?: string | undefined },
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
  it('refuses attachment rows before reading a page and writes nothing', async () => {
    const backend = createFakeBackend({
      stamps: [defaultStamp({ attachmentRows: { count: 2, capped: false } })],
    });
    const h = createHarness({ backend });

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.err).toEqual([
      '❌ [EXPORT_ATTACHMENTS_PRESENT] This chatroom has 2 file attachment(s); attachments cannot be exported.',
    ]);
    expect(h.exits).toEqual([1]);
    expect(h.fs.calls).toEqual([]);
    expect(h.fs.files.size).toBe(0);
  });

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

  it('a refused export creates no default directory and no ignore file', async () => {
    const backend = createFakeBackend({
      stamps: [defaultStamp({ attachmentRows: { count: 1, capped: false } })],
    });
    const h = createHarness({ cwd: '/work', backend });

    await runExport({ chatroomId: 'abc' }, h.deps);

    expect(h.err[0]).toContain('❌ [EXPORT_ATTACHMENTS_PRESENT]');
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
