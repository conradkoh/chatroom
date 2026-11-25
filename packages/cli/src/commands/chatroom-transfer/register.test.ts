/**
 * `registerChatroomTransferCommands` tests.
 *
 * The commander program is the seam: argv parsing, help text and option
 * rejection are exercised on a real `Command` with `exitOverride()`, and the
 * end-to-end case injects deps whose fs is the real node adapter writing into a
 * temp directory. That run covers parsed argv → port → driver → build → atomic
 * publish; the live-deployment run is a later phase.
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportCategory } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
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
  'Export one chatroom (content and configuration) to a JSON file. The file is plaintext and contains conversation content; keep it private.';

/** Temp directories created by the end-to-end case. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stamp(): ExportStamp {
  return {
    attachmentRows: { count: 0, capped: false },
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

/** Transport fake: the stamp and an empty page for every category but room. `anyApi` proxies are not identity comparable, so the argument shape selects the query. */
function fakeBackend(): BackendOps {
  return {
    mutation: async () => {
      throw new Error('chatroom export must not call a mutation');
    },
    query: async (_endpoint: unknown, args: unknown) => {
      const read = args as { category?: ExportCategory };
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
}

function createDeps(options: { fs?: ChatroomTransferFs } = {}): DepsHarness {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const session: SessionOps = {
    getSessionId: async () => 'session-abc' as SessionId,
    getConvexUrl: () => 'https://example.test',
    getOtherSessionUrls: async () => [],
  };
  const deps: ChatroomTransferDeps = {
    backend: fakeBackend(),
    session,
    machine: { getMachineId: async () => 'machine-1' },
    fs: options.fs ?? createNodeChatroomTransferFs(),
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => '/work',
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
  };
  return { deps, out, err, exits };
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
  it('fails through commander when --chatroom-id is missing', async () => {
    const { program } = createProgram(async () => createDeps().deps);

    const error: unknown = await program
      .parseAsync(['node', 'chatroom', 'export'])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect(error).toMatchObject({ exitCode: 1, code: 'commander.missingMandatoryOptionValue' });
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

  it('--help shows the description and both options, and no role or machine identity', async () => {
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
});
