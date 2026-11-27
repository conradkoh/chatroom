/**
 * `registerChatroomTransferCommands` tests.
 *
 * The commander program is the seam: argv parsing, help text and option
 * rejection are exercised on a real `Command` with `exitOverride()`, and the
 * end-to-end case injects deps whose fs is the real node adapter writing into a
 * temp directory. That run covers parsed argv → port → driver → build → atomic
 * publish; the live-deployment run is a later phase.
 */

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportCategory } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import type { ExportableChatroom } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-list';
import type {
  ExportRawRow,
  ExportStamp,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-read';
import { Command, CommanderError } from 'commander';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatroomTransferDeps, ChatroomTransferFs } from './deps.js';
import { createNodeChatroomTransferFs } from './file-io.js';
import { registerChatroomTransferCommands } from './register.js';
import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

const NOW = '2026-11-25T13:04:05Z';
const NAME = 'chatroom-abc-20261125T130405Z.json';
const DESCRIPTION =
  'Export one chatroom (--chatroom-id) or every chatroom you own on this machine (--all) to JSON files. --all writes ONE bundle file. The files are plaintext and contain conversation content; keep them private.';
const IMPORT_DESCRIPTION =
  'Import an export file as a NEW chatroom owned by you. Never merges; importing twice creates two chatrooms. Starts no agents.';

/** Temp directories created by the end-to-end case. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stamp(): ExportStamp {
  return {
    attachmentRows: { count: 0, capped: false, totalBytes: 0 },
    lastActivityAt: 1,
    nextQueuePosition: 1,
    latestMessage: null,
    taskCounts: null,
    latest: {},
  };
}

function room(): ExportRawRow {
  return {
    id: 'room1',
    creationTime: 1,
    fields: { name: 'Test chatroom', status: 'active', teamStructureId: 'ts1' },
  };
}

/** The one room the default fake answers, so `export --all` has something to do. */
const DEFAULT_ROOMS: ExportableChatroom[] = [
  {
    chatroomId: 'room1' as ExportableChatroom['chatroomId'],
    name: 'Test chatroom',
    status: 'active',
  },
];

/** Transport fake: the machine list, the stamp and an empty page for every category but room. `anyApi` proxies are not identity comparable, so the argument shape selects the query. */
function fakeBackend(
  options: { rooms?: ExportableChatroom[] | undefined; queries?: unknown[] | undefined } = {}
): BackendOps {
  const rooms = options.rooms ?? DEFAULT_ROOMS;
  const queries = options.queries ?? [];
  return {
    mutation: async () => {
      throw new Error('chatroom export must not call a mutation');
    },
    query: async (_endpoint: unknown, args: unknown) => {
      queries.push(args);
      const read = args as { category?: ExportCategory; machineId?: string };
      if (read.machineId !== undefined && read.category === undefined) return rooms;
      if (read.category !== undefined) {
        return read.category === 'room'
          ? { rows: [room()], continueCursor: null, isDone: true }
          : { rows: [], continueCursor: null, isDone: true };
      }
      return stamp();
    },
  };
}

interface DepsHarness {
  deps: ChatroomTransferDeps;
  out: string[];
  err: string[];
  exits: number[];
  queries: unknown[];
}

function createDeps(
  options: {
    fs?: ChatroomTransferFs;
    rooms?: ExportableChatroom[];
    cwd?: string;
  } = {}
): DepsHarness {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const queries: unknown[] = [];
  const session: SessionOps = {
    getSessionId: async () => 'session-abc' as SessionId,
    getConvexUrl: () => 'https://example.test',
    getOtherSessionUrls: async () => [],
  };
  const deps: ChatroomTransferDeps = {
    backend: fakeBackend({ rooms: options.rooms, queries }),
    session,
    machine: { getMachineId: async () => 'machine-1' },
    fs: options.fs ?? createNodeChatroomTransferFs(),
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => options.cwd ?? '/work',
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
    signals: { on: () => {}, off: () => {} },
  };
  return { deps, out, err, exits, queries };
}

interface ProgramHarness {
  program: Command;
  output: () => string;
}

/** A real program with inherited exit override and captured output. */
function createProgram(makeDeps: () => Promise<ChatroomTransferDeps>): ProgramHarness {
  const chunks: string[] = [];
  const program = new Command();
  program
    .name('chatroom')
    .exitOverride()
    .configureHelp({ helpWidth: 500 })
    .configureOutput({
      writeOut: (text) => chunks.push(text),
      writeErr: (text) => chunks.push(text),
    });
  registerChatroomTransferCommands(program, async () => undefined, makeDeps);
  return { program, output: () => chunks.join('') };
}

describe('chatroom export wiring', () => {
  it('export with neither flag reaches the wrapper as EXPORT_TARGET_REQUIRED', async () => {
    const { deps, err, exits, queries } = createDeps();
    const { program } = createProgram(async () => deps);

    await program.parseAsync(['node', 'chatroom', 'export']);

    expect(err).toContain('❌ [EXPORT_TARGET_REQUIRED] pass --chatroom-id <id> or --all');
    expect(exits).toEqual([1]);
    expect(queries).toEqual([]);
  });

  it('--all with --chatroom-id reaches the wrapper as EXPORT_TARGET_CONFLICT', async () => {
    const { deps, err, exits } = createDeps();
    const { program } = createProgram(async () => deps);

    await program.parseAsync(['node', 'chatroom', 'export', '--all', '--chatroom-id', 'c']);

    expect(err).toContain(
      '❌ [EXPORT_TARGET_CONFLICT] --all and --chatroom-id cannot be used together'
    );
    expect(exits).toEqual([1]);
  });

  it('rejects --machine-id as an unknown option', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    await expect(
      program.parseAsync(['node', 'chatroom', 'export', '--machine-id', 'x', '--chatroom-id', 'c'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });

  it('rejects --role as an unknown option', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    await expect(
      program.parseAsync(['node', 'chatroom', 'export', '--role', 'builder', '--chatroom-id', 'c'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });

  it('--help shows --all and --chatroom-id <id>, and no role or machine identity', async () => {
    let depsBuilt = 0;
    const { program, output } = createProgram(async () => {
      depsBuilt += 1;
      return createDeps().deps;
    });

    await expect(
      program.parseAsync(['node', 'chatroom', 'export', '--help'])
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed' });

    const help = output();
    expect(help).toContain(DESCRIPTION);
    expect(help).toContain('--all');
    expect(help).toContain('--chatroom-id <id>');
    expect(help).toContain('--path <dir>');
    expect(help).not.toContain('--role');
    expect(help).not.toContain('--machine-id');
    expect(depsBuilt).toBe(0);
  });

  it('publishes a real file from parsed argv, with mode 0o600', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'chatroom-export-e2e-'));
    tempDirs.push(tmpDir);
    const { deps, out, err, exits } = createDeps({ fs: createNodeChatroomTransferFs() });
    const { program } = createProgram(async () => deps);

    await program.parseAsync([
      'node',
      'chatroom',
      'export',
      '--chatroom-id',
      'abc',
      '--path',
      tmpDir,
    ]);

    expect(await readdir(tmpDir)).toEqual([NAME]);
    const filePath = join(tmpDir, NAME);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(out).toContain('Exported chatroom abc');
    expect(err).toEqual([]);
    expect(exits).not.toContain(1);
  });

  it('export --all publishes one real bundle through the node filesystem adapter', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'chatroom-export-all-e2e-'));
    tempDirs.push(tmpDir);
    const { deps, out, err, exits } = createDeps({
      fs: createNodeChatroomTransferFs(),
      cwd: tmpDir,
      rooms: [
        { chatroomId: 'room1' as ExportableChatroom['chatroomId'], name: 'One', status: 'active' },
        { chatroomId: 'room2' as ExportableChatroom['chatroomId'], name: 'Two', status: 'active' },
      ],
    });
    const { program } = createProgram(async () => deps);

    await program.parseAsync(['node', 'chatroom', 'export', '--all']);

    const exportsDir = join(tmpDir, '.chatroom', 'exports');
    const files = (await readdir(exportsDir)).filter((name) => name.endsWith('.json'));
    expect(files).toEqual(['chatroom-all-machine-1-20261125T130405Z.json']);

    const filePath = join(exportsDir, files[0] as string);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    const bundle = JSON.parse(await readFile(filePath, 'utf8')) as {
      kind: string;
      index: { sourceChatroomId: string }[];
      chatrooms: { source: { chatroomId: string } }[];
    };
    expect(bundle.kind).toBe('chatroom-export-bundle');
    expect(bundle.index.map((entry) => entry.sourceChatroomId)).toEqual(['room1', 'room2']);
    expect(bundle.chatrooms.map((payload) => payload.source.chatroomId)).toEqual([
      'room1',
      'room2',
    ]);
    expect(out).toContain('Exported 2 chatrooms from machine machine-1');
    expect(err).toEqual([]);
    expect(exits).toEqual([]);
  });
});

describe('chatroom import wiring', () => {
  it('fails through commander when --path is missing', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    const error: unknown = await program
      .parseAsync(['node', 'chatroom', 'import'])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect(error).toMatchObject({ exitCode: 1, code: 'commander.missingMandatoryOptionValue' });
  });

  it('rejects --machine-id when --path is missing too', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    await expect(
      program.parseAsync(['node', 'chatroom', 'import', '--machine-id', 'x'])
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
  });

  it('rejects --role as an unknown option', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    await expect(
      program.parseAsync(['node', 'chatroom', 'import', '--path', 'f', '--role', 'builder'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });

  it('--help shows the description and options, and no role', async () => {
    let depsBuilt = 0;
    const { program, output } = createProgram(async () => {
      depsBuilt += 1;
      return createDeps().deps;
    });

    await expect(
      program.parseAsync(['node', 'chatroom', 'import', '--help'])
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed' });

    const help = output();
    expect(help).toContain(IMPORT_DESCRIPTION);
    expect(help).toContain('Starts no agents.');
    expect(help).toContain('--machine-id <id>');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--path <file>');
    expect(help).not.toContain('--role');
    expect(depsBuilt).toBe(0);
  });
});
