/**
 * Chatroom import driver — dry run, call order, refs, failure and rollback.
 *
 * These specs run `runImport` over the convex-test port, so validation,
 * preflight, the mutations and rollback are the real implementations. Only the
 * port is substituted, and only to count calls or inject a failure at a port
 * boundary.
 *
 * The fixture is a real export: one message, one task that references it and one
 * backlog item. That yields exactly three chunks (backlog, messages, tasks), and
 * the tasks chunk carries a ref to the message created by an earlier chunk.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  chatroomRowCounts,
  exportPortFor,
  failFinalize,
  failOnNthApplyChunk,
  failRollback,
  importPortFor,
} from './convex-test-ports';
import { runExport } from './export-driver';
import { runImport, type ChatroomImportPort, type ImportOutcome } from './import-driver';
import { api } from '../../../../convex/_generated/api';
import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';
import { ChatroomTransferError } from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let machineCounter = 0;

interface ImportFixture {
  sessionId: SessionId;
  machineId: string;
  sourceChatroomId: Id<'chatroom_rooms'>;
  json: string;
}

async function buildFixture(): Promise<ImportFixture> {
  sessionCounter += 1;
  const sessionId = `import-driver-${sessionCounter}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });

  machineCounter += 1;
  const machineId = `import-driver-machine-${machineCounter}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });

  const sourceChatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'trio@1',
  });
  await insertSourceRows(sourceChatroomId);

  const { json } = await runExport(exportPortFor(t, sessionId), {
    chatroomId: sourceChatroomId,
    cliVersion: 'test',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { sessionId, machineId, sourceChatroomId, json };
}

async function insertSourceRows(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const messageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'hello',
      type: 'message',
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'a task',
      status: 'pending',
      queuePosition: 0,
      createdAt: 1,
      updatedAt: 2,
      sourceMessageId: messageId,
    });
    await ctx.db.insert('chatroom_backlog', {
      chatroomId,
      createdBy: 'user',
      content: 'an item',
      status: 'backlog',
      createdAt: 1,
      updatedAt: 2,
    });
  });
}

interface CountingPort {
  port: ChatroomImportPort;
  calls: string[];
}

/** Records the name of every port method called; substitution happens only at the port. */
function counting(port: ChatroomImportPort): CountingPort {
  const calls: string[] = [];
  return {
    calls,
    port: {
      preflight: (a) => {
        calls.push('preflight');
        return port.preflight(a);
      },
      begin: (a) => {
        calls.push('begin');
        return port.begin(a);
      },
      applyChunk: (a) => {
        calls.push('applyChunk');
        return port.applyChunk(a);
      },
      finalize: (a) => {
        calls.push('finalize');
        return port.finalize(a);
      },
      rollback: (a) => {
        calls.push('rollback');
        return port.rollback(a);
      },
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected runImport to fail');
}

/** The plan of the same file, read from a dry run (zero writes). */
async function planFor(fixture: ImportFixture) {
  const outcome = await runImport(importPortFor(t, fixture.sessionId), {
    json: fixture.json,
    machineId: fixture.machineId,
    dryRun: true,
  });
  if (outcome.status !== 'dry-run') throw new Error(`expected a dry run, got ${outcome.status}`);
  return outcome.plan;
}

/** Every row in every schema table, so a write anywhere shows up. */
async function allRowCounts(): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return counts;
  });
}

function importedChatroomId(outcome: ImportOutcome): Id<'chatroom_rooms'> {
  if (outcome.status !== 'imported') {
    throw new Error(`expected an imported outcome, got ${outcome.status}`);
  }
  return outcome.chatroomId as Id<'chatroom_rooms'>;
}

function rolledBackCause(outcome: ImportOutcome): Error {
  if (outcome.status !== 'rolled-back') {
    throw new Error(`expected a rolled-back outcome, got ${outcome.status}`);
  }
  return outcome.cause;
}

function applyCalls(calls: readonly string[]): number {
  return calls.filter((call) => call === 'applyChunk').length;
}

// ---------------------------------------------------------------------------
// Read-only paths
// ---------------------------------------------------------------------------

describe('before any write', () => {
  test('a dry run returns the plan and makes no write call', async () => {
    const fixture = await buildFixture();
    const before = await allRowCounts();
    const sourceBefore = await chatroomRowCounts(fixture.sourceChatroomId);

    const { port, calls } = counting(importPortFor(t, fixture.sessionId));
    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: true,
    });

    if (outcome.status !== 'dry-run') throw new Error(`got ${outcome.status}`);
    expect(outcome.plan.chunks).toHaveLength(3);
    expect(calls).toEqual(['preflight']);
    expect(await allRowCounts()).toEqual(before);
    expect(await chatroomRowCounts(fixture.sourceChatroomId)).toEqual(sourceBefore);
  });

  test('a checksum mismatch refuses before calling the port', async () => {
    const fixture = await buildFixture();
    const tampered = tamperChecksum(fixture.json);
    const { port, calls } = counting(importPortFor(t, fixture.sessionId));

    const error = await failure(
      runImport(port, { json: tampered, machineId: fixture.machineId, dryRun: false })
    );

    expect(error).toBeInstanceOf(ChatroomTransferError);
    expect((error as ChatroomTransferError).code).toBe('IMPORT_CHECKSUM_MISMATCH');
    expect(calls).toEqual([]);
  });
});

/** Flips the last character of the checksum, so the content no longer matches. */
function tamperChecksum(json: string): string {
  const parsed = JSON.parse(json) as { checksum: string };
  const last = parsed.checksum.slice(-1);
  parsed.checksum = `${parsed.checksum.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  return JSON.stringify(parsed);
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

describe('write path', () => {
  test('applies every chunk once in order, then finalizes', async () => {
    const fixture = await buildFixture();
    const plan = await planFor(fixture);
    const { port, calls } = counting(importPortFor(t, fixture.sessionId));

    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
    });

    expect(calls).toEqual([
      'preflight',
      'begin',
      'applyChunk',
      'applyChunk',
      'applyChunk',
      'finalize',
    ]);

    const chatroomId = importedChatroomId(outcome);
    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room?.status).toBe(plan.finalize.status);
  });

  test('fills refs only from keys an earlier chunk created', async () => {
    const fixture = await buildFixture();
    const base = importPortFor(t, fixture.sessionId);
    const applied: { refs: Record<string, string>; created: Record<string, string> }[] = [];
    const port: ChatroomImportPort = {
      ...base,
      applyChunk: async (a) => {
        const result = await base.applyChunk(a);
        applied.push({ refs: a.chunk.refs, created: result.created });
        return result;
      },
    };

    await runImport(port, { json: fixture.json, machineId: fixture.machineId, dryRun: false });

    expect(applied).toHaveLength(3);
    expect(applied[0].refs).toEqual({});
    applied.forEach((entry, index) => {
      for (const key of Object.keys(entry.refs)) {
        expect(applied.slice(0, index).some((earlier) => key in earlier.created)).toBe(true);
      }
    });
    // The task row references the message, so the last chunk carries its ref.
    expect(applied[2].refs).toEqual({ m0: applied[1].created.m0 });
  });
});

// ---------------------------------------------------------------------------
// Failure and rollback
// ---------------------------------------------------------------------------

const FAILURE_CASES = [
  ['first-before', 'first', 'before'],
  ['middle-before', 'middle', 'before'],
  ['last-before', 'last', 'before'],
  ['first-after', 'first', 'after'],
  ['middle-after', 'middle', 'after'],
  ['last-after', 'last', 'after'],
  ['finalize', 'finalize', 'after'],
] as const;

type FailurePosition = (typeof FAILURE_CASES)[number][1];

/** 1-based chunk index the case fails at; `finalize` has no applyChunk failure. */
function failingChunk(position: FailurePosition, chunks: number): number {
  if (position === 'first') return 1;
  if (position === 'middle') return Math.ceil(chunks / 2);
  return chunks;
}

describe('rollback', () => {
  test.each(FAILURE_CASES)(
    'a %s failure rolls the import back to zero rows',
    async (_name, position, when) => {
      const fixture = await buildFixture();
      const plan = await planFor(fixture);
      const chunks = plan.chunks.length;
      const index = failingChunk(position, chunks);

      const base = importPortFor(t, fixture.sessionId);
      const failing =
        position === 'finalize' ? failFinalize(base) : failOnNthApplyChunk(base, index, when);
      const { port, calls } = counting(failing);

      let started: string | undefined;
      const outcome = await runImport(port, {
        json: fixture.json,
        machineId: fixture.machineId,
        dryRun: false,
        onStarted: (chatroomId) => {
          started = chatroomId;
        },
      });

      expect(started).toBeDefined();
      expect(rolledBackCause(outcome).message).toContain('injected');
      expect(await chatroomRowCounts(started as Id<'chatroom_rooms'>)).toEqual({});
      expect(applyCalls(calls)).toBe(position === 'finalize' ? chunks : index);
    }
  );

  test('a rollback failure is reported with the orphaned room, not hidden', async () => {
    const fixture = await buildFixture();
    const base = importPortFor(t, fixture.sessionId);
    const port = failRollback(failOnNthApplyChunk(base, 2, 'after'));

    let started: string | undefined;
    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
      onStarted: (chatroomId) => {
        started = chatroomId;
      },
    });

    expect(started).toBeDefined();
    if (outcome.status !== 'rollback-failed') throw new Error(`got ${outcome.status}`);
    expect(outcome.orphanChatroomId).toBe(started);
    expect(outcome.cause.message).toContain('injected');
    expect(outcome.rollbackError.message).toContain('injected');

    const counts = await chatroomRowCounts(started as Id<'chatroom_rooms'>);
    expect(counts).toMatchObject({ chatroom_rooms: 1, chatroom_messages: 1, chatroom_backlog: 1 });
  });

  test('an abort after the first chunk rolls the import back', async () => {
    const fixture = await buildFixture();
    const controller = new AbortController();
    const base = importPortFor(t, fixture.sessionId);
    let applied = 0;
    const port: ChatroomImportPort = {
      ...base,
      applyChunk: async (a) => {
        const result = await base.applyChunk(a);
        applied += 1;
        controller.abort();
        return result;
      },
    };

    let started: string | undefined;
    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
      signal: controller.signal,
      onStarted: (chatroomId) => {
        started = chatroomId;
      },
    });

    expect(outcome.status).toBe('rolled-back');
    expect(applied).toBe(1);
    expect(await chatroomRowCounts(started as Id<'chatroom_rooms'>)).toEqual({});
  });
});
