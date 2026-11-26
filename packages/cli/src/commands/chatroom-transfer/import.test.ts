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
  EXPORT_MAX_FILE_BYTES,
  type ExportCategory,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
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

import type { ChatroomTransferDeps, ChatroomTransferFs, TransferSignals } from './deps.js';
import { formatTransferError } from './export.js';
import { importChatroom, type ImportOptions } from './import.js';
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
function rawRows(): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [
      rawRow('room1', 1, { name: 'Imported room', status: 'active', teamStructureId: 'trio@1' }),
    ],
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
  rows: Record<ExportCategory, ExportRawRow[]> = rawRows()
): Promise<string> {
  const port: ChatroomExportPort = {
    getStamp: async () => emptyStamp(),
    readPage: async ({ category }) => ({
      rows: rows[category],
      continueCursor: null,
      isDone: true,
    }),
  };
  const { json } = await runExport(port, {
    chatroomId: 'source-room',
    cliVersion: 'test',
    now: () => new Date(NOW),
  });
  return json;
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
  rollbackCalls: number;
}

function createScriptedPort(options: PortOptions = {}): ScriptedPort {
  const calls: string[] = [];
  const preflightArgs: ScriptedPort['preflightArgs'] = [];
  const applyChunks: ImportChunk[] = [];
  let rollbackCalls = 0;
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
      return target;
    },
    begin: async () => {
      calls.push('begin');
      return { chatroomId: ORPHAN_ID };
    },
    applyChunk: async (a) => {
      calls.push('applyChunk');
      applyChunks.push(a.chunk);
      const callIndex = applyChunks.length;
      options.onApplyChunk?.(callIndex);
      if (options.failApplyChunkAt === callIndex) {
        throw new Error(`injected applyChunk failure at ${callIndex}`);
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
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const fs = new MemoryFs();
  if (options.fileExists !== false) {
    fs.files.set(EXPORT_PATH, options.storeJson ?? (await buildExport()));
    if (options.statSize !== undefined) fs.sizes.set(EXPORT_PATH, options.statSize);
  }
  const signals = createSignals();
  const machineId = options.machineId === undefined ? 'machine-1' : options.machineId;

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
  const deps: ChatroomTransferDeps = {
    backend,
    session,
    machine: { getMachineId: async () => machineId },
    fs,
    clock: () => new Date(NOW),
    version: '1.0.0-test',
    cwd: () => CWD,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    exit: (code) => exits.push(code),
    signals: signals.signals,
  };
  return { deps, out, err, exits, fs, signals };
}

/** Runs the command body with the wrapper `register.ts` applies around it. */
async function runImport(
  opts: ImportOptions,
  deps: ChatroomTransferDeps,
  makePort: () => ChatroomImportPort
): Promise<void> {
  try {
    await importChatroom(opts, deps, makePort);
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

    await runImport({ path: EXPORT_PATH, dryRun: true }, h.deps, () => scripted.port);

    expect(scripted.calls).toEqual(['preflight']);
    expect(h.out).toContain('dry run: nothing was written');
    expect(h.exits).not.toContain(1);
  });

  it('--machine-id wins over the stored identity', async () => {
    const h = await createHarness({ machineId: 'stored' });
    const scripted = createScriptedPort();

    await runImport(
      { path: EXPORT_PATH, dryRun: true, machineId: 'given' },
      h.deps,
      () => scripted.port
    );

    expect(scripted.preflightArgs[0]?.machineId).toBe('given');
  });

  it('no identity and no --machine-id is refused', async () => {
    const h = await createHarness({ machineId: null });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('[IMPORT_NO_MACHINE_IDENTITY]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('a non-file path is refused', async () => {
    const h = await createHarness({ fileExists: false });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('[IMPORT_FILE_UNREADABLE]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('refuses a file over the export maximum before reading it', async () => {
    const h = await createHarness({ statSize: EXPORT_MAX_FILE_BYTES + 1 });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('[IMPORT_FILE_TOO_LARGE]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(h.fs.readCalls).toEqual([]);
    expect(scripted.calls).toEqual([]);
  });

  it('a file exactly at the limit is not refused for size', async () => {
    const h = await createHarness({ statSize: EXPORT_MAX_FILE_BYTES });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.fs.readCalls).toEqual([EXPORT_PATH]);
    expect(h.err.some((line) => line.includes('IMPORT_FILE_TOO_LARGE'))).toBe(false);
  });

  it('an invalid file is refused before any port call', async () => {
    const tampered = tamperChecksum(await buildExport());
    const h = await createHarness({ storeJson: tampered });
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('[IMPORT_CHECKSUM_MISMATCH]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.calls).toEqual([]);
  });

  it('agent config skips are printed with their reason', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort();

    await runImport({ path: EXPORT_PATH, dryRun: true }, h.deps, () => scripted.port);

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

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

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

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('❌ [IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(saysSuccess(h)).toBe(false);
  });

  it('rollback-failed exits 1, names the orphan chatroom, and says it may be active', async () => {
    const h = await createHarness();
    const scripted = createScriptedPort({ failApplyChunkAt: 2, failRollback: true });

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    const errorLine = h.err.find((line) => line.includes('[IMPORT_ROLLBACK_FAILED]'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain(ORPHAN_ID);
    expect(errorLine).toContain('may be active');
    expect(errorLine).toContain('archive or delete');
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

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

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

    await runImport({ path: EXPORT_PATH }, h.deps, () => scripted.port);

    expect(h.err.some((line) => line.includes('[IMPORT_ROLLED_BACK]'))).toBe(true);
    expect(h.exits).toEqual([1]);
    expect(scripted.rollbackCalls).toBeGreaterThan(0);
    expect(h.signals.offCalls).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
    expect(h.signals.active('SIGINT')).toBe(0);
    expect(h.signals.active('SIGTERM')).toBe(0);
  });
});
