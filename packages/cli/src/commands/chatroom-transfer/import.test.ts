/**
 * `importChatroom` tests.
 *
 * The Convex transport is substituted at `makePort` (a scripted
 * `ChatroomImportPort`), the session at `SessionOps`, the machine identity at
 * `deps.machine`, the file system at `ChatroomTransferFs`, and the OS signals at
 * `deps.signals`. The real `runImport` driver runs against a real, checksummed
 * export file built by the real `runExport`.
 *
 * Failures are rendered by the same `[CODE] message` + `exit(1)` contract that
 * `register.ts` applies around the command body.
 */

import { resolve } from 'node:path';

import {
  ChatroomTransferError,
  EXPORT_MAX_FILE_BYTES,
  TRANSFER_ERROR_CODES,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import {
  runExport,
  type ChatroomExportPort,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type {
  ExportRawRow,
  ExportStamp,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-read';
import type { ImportChunk } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-apply';
import type { ChatroomImportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-driver';
import type { ImportTarget } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-plan';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it } from 'vitest';

import type {
  ChatroomTransferDeps,
  ChatroomTransferFs,
  TransferPrompt,
  TransferSignals,
} from './deps.js';
import { formatTransferError } from './export.js';
import { importChatroom, type ImportOptions, type ImportRuntime } from './import.js';
import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

const NOW = '2026-11-25T13:04:05Z';
const CWD = '/work';
const EXPORT_PATH = resolve(CWD, 'export.json');
/** The id the scripted `begin` returns; rollback-failed must name it. */
const ORPHAN_ID = 'imported-room-id';
/** A harness the fake preflight does not report, so its config is skipped. */
const UNAVAILABLE_HARNESS = 'unavailable-harness';

// ---------------------------------------------------------------------------
// Fixture: a real, checksummed export built by runExport
// ---------------------------------------------------------------------------

function rawRow(id: string, creationTime: number, fields: Record<string, unknown>): ExportRawRow {
  return { id, creationTime, fields };
}

/** One room, one workspace, one skipped agent config, one message, one task. */
function rawRows(name = 'Imported room'): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [rawRow('room1', 1, { name, status: 'active', teamStructureId: 'trio@1' })],
    workspaces: [
      rawRow('ws1', 2, { workingDir: CWD, machineId: 'machine-1', fileTreeSyncEnabled: true }),
    ],
    agentConfigs: [
      rawRow('cfg1', 3, {
        role: 'builder',
        agentType: 'remote',
        agentHarness: UNAVAILABLE_HARNESS,
        model: 'model-x',
        workingDir: CWD,
        workspaceId: 'ws1',
        teamStructureId: 'trio@1',
        requestedAt: 1,
      }),
    ],
    messages: [rawRow('msg1', 4, { senderRole: 'user', content: 'hello', type: 'message' })],
    messageQueue: [],
    tasks: [
      rawRow('task1', 5, {
        createdBy: 'user',
        content: 'a task',
        status: 'pending',
        queuePosition: 0,
        createdAt: 1,
        updatedAt: 2,
        sourceMessageId: 'msg1',
      }),
    ],
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

/** Builds the export with the real driver so the checksum and keys are real. */
async function buildExport(
  rows: Record<ExportCategory, ExportRawRow[]> = rawRows(),
  chatroomId = 'source-room'
): Promise<string> {
  const { json } = await runExport(portFor(new Map([[chatroomId, rows]])), {
    chatroomId,
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return json;
}

/** Answers each chatroom id with its own rows. */
function portFor(
  rooms: ReadonlyMap<string, Record<ExportCategory, ExportRawRow[]>>
): ChatroomExportPort {
  return {
    getStamp: async () => emptyStamp(),
    readPage: async ({ chatroomId, category }) => ({
      rows: rooms.get(chatroomId)?.[category] ?? [],
      continueCursor: null,
      isDone: true,
    }),
  };
}

interface BundleFixture {
  json: string;
  keys: string[];
}

/** Two distinct chatrooms, plus a bundle built by the real `runExportBundle`. */
async function buildBundle(
  names: readonly string[] = ['Room one', 'Room two']
): Promise<BundleFixture> {
  const rooms = new Map(
    names.map((name, index) => [`bundle-room-${index + 1}`, rawRows(name)] as const)
  );
  const keys = [...rooms.keys()];
  const { json } = await runExportBundle(portFor(rooms), {
    chatroomIds: keys,
    machineId: 'machine-1',
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return { json, keys };
}

/** Flips the last character of the checksum so the content no longer matches. */
function tamperChecksum(json: string): string {
  const parsed = JSON.parse(json) as { checksum: string };
  const last = parsed.checksum.slice(-1);
  parsed.checksum = `${parsed.checksum.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  return JSON.stringify(parsed);
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** In-memory fs with the same no-overwrite contract as the node adapter. */
class MemoryFs implements ChatroomTransferFs {
  readonly files = new Map<string, string>();
  /** Paths `readFile` was called with, so a test can assert a file was never read. */
  readonly readCalls: string[] = [];
  /** Size overrides, so a test can model a file larger than its stored bytes. */
  readonly sizes = new Map<string, number>();

  async mkdirp(): Promise<void> {}

  async writeExclusive(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async link(existing: string, newPath: string): Promise<void> {
    const data = this.files.get(existing);
    if (data === undefined) throw errnoError('ENOENT');
    this.files.set(newPath, data);
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }

  async readFile(path: string): Promise<string> {
    this.readCalls.push(path);
    const data = this.files.get(path);
    if (data === undefined) throw errnoError('ENOENT');
    return data;
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    const data = this.files.get(path);
    return {
      isFile: data !== undefined,
      isDirectory: false,
      size: this.sizes.get(path) ?? data?.length ?? 0,
    };
  }
}

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

type Signal = 'SIGINT' | 'SIGTERM';

interface SignalHarness {
  signals: TransferSignals;
  fire: (signal: Signal) => void;
  offCalls: Signal[];
  active: (signal: Signal) => number;
}

function createSignals(): SignalHarness {
  const handlers = new Map<Signal, Set<() => void>>([
    ['SIGINT', new Set()],
    ['SIGTERM', new Set()],
  ]);
  const offCalls: Signal[] = [];
  return {
    offCalls,
    signals: {
      on: (signal, handler) => {
        handlers.get(signal)?.add(handler);
      },
      off: (signal, handler) => {
        offCalls.push(signal);
        handlers.get(signal)?.delete(handler);
      },
    },
    fire: (signal) => {
      for (const handler of [...(handlers.get(signal) ?? [])]) handler();
    },
    active: (signal) => handlers.get(signal)?.size ?? 0,
  };
}

interface PortOptions {
  /** 1-based applyChunk call that throws. */
  failApplyChunkAt?: number;
  /** 1-based `begin` call whose first applyChunk throws, so that chatroom rolls back. */
  failApplyForBeginCall?: number;
  /** 1-based `begin` call that throws. */
  failBeginOnCall?: number;
  /** Throws from every preflight; models a target-wide refusal. */
  preflightError?: unknown;
  failFinalize?: boolean;
  failRollback?: boolean;
  /** Runs before the chunk result is returned; used to fire a signal. */
  onApplyChunk?: (callIndex: number) => void;
  target?: Partial<ImportTarget & { hostname: string }>;
}

interface ScriptedPort {
  port: ChatroomImportPort;
  calls: string[];
  preflightArgs: { machineId: string; teamStructureId: string; workingDirs: string[] }[];
  applyChunks: ImportChunk[];
  beginCalls: number;
  rollbackCalls: number;
}

function createScriptedPort(options: PortOptions = {}): ScriptedPort {
  const calls: string[] = [];
  const preflightArgs: ScriptedPort['preflightArgs'] = [];
  const applyChunks: ImportChunk[] = [];
  let rollbackCalls = 0;
  let beginCalls = 0;
  let currentBeginCall = 0;
  const target: ImportTarget & { hostname: string } = {
    machineId: 'machine-1',
    availableHarnesses: ['opencode-sdk'],
    teamStructureKnown: true,
    invalidWorkingDirs: [],
    hostname: 'host',
    ...options.target,
  };

  const port: ChatroomImportPort = {
    preflight: async (a) => {
      calls.push('preflight');
      preflightArgs.push(a);
      if (options.preflightError !== undefined) throw options.preflightError;
      return target;
    },
    begin: async () => {
      calls.push('begin');
      beginCalls += 1;
      currentBeginCall = beginCalls;
      if (options.failBeginOnCall === currentBeginCall) {
        throw new Error(`injected begin failure at ${currentBeginCall}`);
      }
      return { chatroomId: beginCalls === 1 ? ORPHAN_ID : `imported-room-${beginCalls}` };
    },
    applyChunk: async (a) => {
      calls.push('applyChunk');
      applyChunks.push(a.chunk);
      const callIndex = applyChunks.length;
      options.onApplyChunk?.(callIndex);
      if (options.failApplyChunkAt === callIndex) {
        throw new Error(`injected applyChunk failure at ${callIndex}`);
      }
      if (options.failApplyForBeginCall === currentBeginCall) {
        throw new Error(`injected applyChunk failure for begin ${currentBeginCall}`);
      }
      if (a.chunk.phase === 'links') return { created: {} };
      return { created: Object.fromEntries(a.chunk.rows.map((row) => [row.key, `id-${row.key}`])) };
    },
    finalize: async () => {
      calls.push('finalize');
      if (options.failFinalize) throw new Error('injected finalize failure');
    },
    rollback: async () => {
      calls.push('rollback');
      rollbackCalls += 1;
      if (options.failRollback) throw new Error('injected rollback failure');
      return { drained: true, deleted: 0 };
    },
  };

  return {
    port,
    calls,
    preflightArgs,
    applyChunks,
    get beginCalls() {
      return beginCalls;
    },
    get rollbackCalls() {
      return rollbackCalls;
    },
  };
}

interface Harness {
  deps: ChatroomTransferDeps;
  out: string[];
  err: string[];
  exits: number[];
  fs: MemoryFs;
  signals: SignalHarness;
  /** Answers the next prompt call; the last answer repeats when exhausted. */
  questions: string[];
  machineIdCalls: { count: number };
}

interface HarnessOptions {
  /** Store this JSON instead of the default fixture. */
  storeJson?: string;
  /** When false the export path does not exist. */
  fileExists?: boolean;
  /** `null` means this machine has no identity. */
  machineId?: string | null;
  /** Report this size from `stat` instead of the stored byte length. */
  statSize?: number;
  /** Terminal answers, in order. */
  answers?: string[];
  /** Whether a terminal is available at all. */
  interactive?: boolean;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const questions: string[] = [];
  const fs = new MemoryFs();
  if (options.fileExists !== false) {
    fs.files.set(EXPORT_PATH, options.storeJson ?? (await buildExport()));
    if (options.statSize !== undefined) fs.sizes.set(EXPORT_PATH, options.statSize);
  }
  const signals = createSignals();
  const machineId = options.machineId === undefined ? 'machine-1' : options.machineId;
  const machineIdCalls = { count: 0 };
  const answers = [...(options.answers ?? [])];

  const session: SessionOps = {
    getSessionId: async () => 'session-abc' as SessionId,
    getConvexUrl: () => 'https://example.test',
    getOtherSessionUrls: async () => [],
  };
  const backend: BackendOps = {
    mutation: async () => {
      throw new Error('the scripted port must be the only transport');
    },
    query: async () => {
      throw new Error('the scripted port must be the only transport');
    },
  };
  const prompt: TransferPrompt = {
    isInteractive: () => options.interactive === true,
    ask: async (question) => {
      questions.push(question);
      return answers.length > 1 ? (answers.shift() as string) : (answers[0] ?? '');
    },
  };
  const deps: ChatroomTransferDeps = {
    backend,
    session,
    machine: {
      getMachineId: async () => {
        machineIdCalls.count += 1;
        return machineId;
      },
    },
    fs,
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => CWD,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
    signals: signals.signals,
    prompt,
  };
  return { deps, out, err, exits, fs, signals, questions, machineIdCalls };
}

/** Runs the command body with the wrapper `register.ts` applies around it. */
async function runImport(
  opts: ImportOptions,
  deps: ChatroomTransferDeps,
  runtime: ImportRuntime = {}
): Promise<void> {
  try {
    await importChatroom(opts, deps, runtime);
  } catch (error) {
    const formatted = formatTransferError(error);
    deps.err(`❌ [${formatted.code}] ${formatted.message}`);
    deps.exit(1);
  }
}

function lines(h: Harness): string[] {
  return [...h.out, ...h.err];
}

function saysSuccess(h: Harness): boolean {
  return lines(h).some((line) => line.toLowerCase().includes('success'));
}

// ---------------------------------------------------------------------------
// Read-only paths
// ---------------------------------------------------------------------------

describe('importChatroom (read-only)', () => {
  it('dry run prints the plan and writes nothing', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH, dryRun: true }, h.deps, { makePort: () => scripted.port });

    expect(scripted.calls).toEqual(['preflight']);
    expect(h.out).toContain('dry run: nothing was written');
    expect(h.exits).not.toContain(1);
  });

  it('--machine-id wins over the stored identity', async () => {
    const h = await createHarness({ machineId: 'stored' });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH, dryRun: true, machineId: 'given' }, h.deps, {
      makePort: () => scripted.port,
    });

    expect(scripted.preflightArgs[0]?.machineId).toBe('given');
  });

  it('no identity and no --machine-id is refused', async () => {
    const h = await createHarness({ machineId: null });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_NO_MACHINE_IDENTITY]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('a non-file path is refused', async () => {
    const h = await createHarness({ fileExists: false });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_FILE_UNREADABLE]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('refuses a file over the export maximum before reading it', async () => {
    const h = await createHarness({ statSize: EXPORT_MAX_FILE_BYTES + 1 });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_FILE_TOO_LARGE]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(h.fs.readCalls).toEqual([]);
    expect(scripted.calls).toEqual([]);
  });

  it('a file exactly at the limit is not refused for size', async () => {
    const h = await createHarness({ statSize: EXPORT_MAX_FILE_BYTES });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.fs.readCalls).toEqual([EXPORT_PATH]);
    expect(h.err.some((line) => line.includes('IMPORT_FILE_TOO_LARGE'))).toBe(false);
  });

  it('an invalid file is refused before any port call', async () => {
    const tampered = tamperChecksum(await buildExport());
    const h = await createHarness({ storeJson: tampered });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_CHECKSUM_MISMATCH]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('agent config skips are printed with their reason', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH, dryRun: true }, h.deps, { makePort: () => scripted.port });

    expect(h.out).toContain('  skipped agent config g0: harness_unavailable');
  });
});

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

describe('importChatroom (write path)', () => {
  it('a real import prints the new chatroom, the caveats and the exact no-agents line', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    const output = h.out.join('\n');
    expect(output).toContain('Imported as new chatroom');
    expect(output).toContain('message creation times were set to import time');
    expect(h.out).toContain('no agents were started');
    expect(h.err).toEqual([]);
    expect(h.exits).not.toContain(1);
    expect(scripted.calls).toContain('finalize');
  });

  it('rolled-back exits 1 with IMPORT_ROLLED_BACK and never says success', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort({ failApplyChunkAt: 2 });

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('❌ [IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(saysSuccess(h)).toBe(false);
  });

  it('rollback-failed exits 1, names the orphan chatroom, and says it may be active', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort({ failApplyChunkAt: 2, failRollback: true });

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    const errorLine = h.err.find(
      (line) => line.includes(ORPHAN_ID) && line.includes('archive or delete')
    );
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('may be active');
    expect(h.err.some((line) => line.includes('[IMPORT_ROLLBACK_FAILED]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(saysSuccess(h)).toBe(false);
  });

  it('SIGINT during the write aborts and rolls back', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort({
      onApplyChunk: (callIndex) => {
        if (callIndex === 1) h.signals.fire('SIGINT');
      },
    });

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.rollbackCalls).toBeGreaterThan(0);
    expect(h.signals.offCalls).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
    expect(h.signals.active('SIGINT')).toBe(0);
    expect(h.signals.active('SIGTERM')).toBe(0);
  });

  it('SIGTERM behaves the same as SIGINT', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort({
      onApplyChunk: (callIndex) => {
        if (callIndex === 1) h.signals.fire('SIGTERM');
      },
    });

    await runImport({ path: EXPORT_PATH }, h.deps, { makePort: () => scripted.port });

    expect(h.err.some((line) => line.includes('[IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.rollbackCalls).toBeGreaterThan(0);
    expect(h.signals.offCalls).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
    expect(h.signals.active('SIGINT')).toBe(0);
    expect(h.signals.active('SIGTERM')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Offline listing and bundle selection
// ---------------------------------------------------------------------------

/** Counts the auth hook without doing any I/O. */
function authSpy(): { ensureAuth: () => Promise<void>; calls: () => number } {
  let calls = 0;
  return {
    ensureAuth: async () => {
      calls += 1;
    },
    calls: () => calls,
  };
}

describe('importChatroom (offline listing)', () => {
  it('--list on a bundle prints every entry without auth, backend calls or a machine id', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort();
    const auth = authSpy();
    let makePortCalls = 0;

    await runImport({ path: EXPORT_PATH, list: true }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => {
        makePortCalls += 1;
        return scripted.port;
      },
    });

    expect(h.out[0]).toBe(`Bundle exported ${new Date(NOW).toISOString()}: 2 chatroom(s)`);
    expect(h.out).toContain(`[1] Room one`);
    expect(h.out).toContain(`[2] Room two`);
    expect(auth.calls()).toBe(0);
    expect(makePortCalls).toBe(0);
    expect(h.machineIdCalls.count).toBe(0);
    expect(scripted.calls).toEqual([]);
    expect(h.exits).toEqual([]);
    expect(h.err).toEqual([]);
  });

  it('--list on a single file prints its details and needs no auth', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH, list: true }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => scripted.port,
    });

    expect(h.out).toContain(
      `Export of chatroom source-room exported ${new Date(NOW).toISOString()}`
    );
    expect(h.out).toContain('[1] Imported room');
    expect(auth.calls()).toBe(0);
    expect(h.machineIdCalls.count).toBe(0);
    expect(scripted.calls).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('a single file with a bad checksum fails at listing before auth or any backend call', async () => {
    const tampered = tamperChecksum(await buildExport());
    const h = await createHarness({ storeJson: tampered });
    const scripted = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => scripted.port,
    });

    expect(h.err.some((line) => line.includes('[IMPORT_CHECKSUM_MISMATCH]'))).toBe(true);
    expect(auth.calls()).toBe(0);
    expect(scripted.calls).toEqual([]);
    expect(h.exits).toEqual([1]);
  });
});

describe('importChatroom (bundle selection)', () => {
  it('refuses a bundle with no --select when there is no terminal', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => scripted.port,
    });

    expect(h.out).toContain(`Bundle exported ${new Date(NOW).toISOString()}: 2 chatroom(s)`);
    expect(h.err.some((line) => line.includes('[IMPORT_SELECTION_REQUIRED]'))).toBe(true);
    expect(auth.calls()).toBe(0);
    expect(scripted.calls).toEqual([]);
    expect(h.exits).toEqual([1]);
  });

  it('--select 1 imports only the first entry and reports 1 of 1', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH, select: '1' }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => scripted.port,
    });

    expect(auth.calls()).toBe(1);
    expect(scripted.beginCalls).toBe(1);
    expect(scripted.preflightArgs).toHaveLength(1);
    expect(h.out).toContain('Imported 1 of 1 selected; Failed: 0');
    expect(h.out.some((line) => line.startsWith('Imported as new chatroom'))).toBe(true);
    expect(h.exits).not.toContain(1);
  });

  it('--select all keeps the first import when the second fails and rolls only that one back', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort({ failApplyForBeginCall: 2 });

    await runImport({ path: EXPORT_PATH, select: 'all' }, h.deps, {
      makePort: () => scripted.port,
    });

    expect(scripted.beginCalls).toBe(2);
    expect(scripted.rollbackCalls).toBe(1);
    expect(h.out).toContain('Imported 1 of 2 selected; Failed: 1');
    expect(h.err.some((line) => line.includes('❌ [IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
  });

  it('a terminal answer selects chatrooms, and an empty answer imports nothing', async () => {
    const bundle = await buildBundle();
    const interactive = await createHarness({
      storeJson: bundle.json,
      interactive: true,
      answers: ['1,2'],
    });
    const first = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, interactive.deps, {
      makePort: () => first.port,
    });

    expect(interactive.questions).toEqual([
      'Import which chatrooms? (all, or numbers/ids comma-separated; empty = none): ',
    ]);
    expect(first.beginCalls).toBe(2);
    expect(interactive.out).toContain('Imported 2 of 2 selected; Failed: 0');

    const empty = await createHarness({
      storeJson: bundle.json,
      interactive: true,
      answers: [''],
    });
    const second = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH }, empty.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => second.port,
    });

    expect(empty.out).toContain('Nothing selected; nothing was imported.');
    expect(auth.calls()).toBe(0);
    expect(second.calls).toEqual([]);
    expect(empty.exits).toEqual([]);
  });

  it('a target-wide refusal fails the first entry and marks the rest fatal', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort({
      preflightError: new ChatroomTransferError(
        TRANSFER_ERROR_CODES.IMPORT_MACHINE_NOT_OWNED,
        'machine not owned'
      ),
    });

    await runImport({ path: EXPORT_PATH, select: 'all' }, h.deps, {
      makePort: () => scripted.port,
    });

    expect(h.out).toContain(`Not started (fatal): ${bundle.keys[1]}`);
    expect(h.err.some((line) => line.includes('[IMPORT_MACHINE_NOT_OWNED]'))).toBe(true);
    expect(scripted.preflightArgs).toHaveLength(1);
    expect(h.exits).toEqual([1]);
  });

  it('--dry-run preflights each selected entry and writes nothing', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH, select: 'all', dryRun: true }, h.deps, {
      makePort: () => scripted.port,
    });

    expect(scripted.preflightArgs).toHaveLength(2);
    expect(scripted.beginCalls).toBe(0);
    expect(scripted.applyChunks).toEqual([]);
    expect(h.out).toContain('dry run: nothing was written');
    expect(h.exits).not.toContain(1);
  });

  it('--select with an unknown token fails before auth or any backend call', async () => {
    const bundle = await buildBundle();
    const h = await createHarness({ storeJson: bundle.json });
    const scripted = createScriptedPort();
    const auth = authSpy();

    await runImport({ path: EXPORT_PATH, select: '1,9' }, h.deps, {
      ensureAuth: auth.ensureAuth,
      makePort: () => scripted.port,
    });

    expect(h.err.some((line) => line.includes('[IMPORT_SELECTION_INVALID]'))).toBe(true);
    expect(auth.calls()).toBe(0);
    expect(scripted.calls).toEqual([]);
    expect(h.machineIdCalls.count).toBe(0);
    expect(h.exits).toEqual([1]);
  });
});
