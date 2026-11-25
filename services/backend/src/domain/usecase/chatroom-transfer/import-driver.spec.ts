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
import {
  ChatroomTransferError,
  type ChatroomExportFileV1,
} from '../../entities/chatroom-transfer-file';
import { syncMessageReadModel } from '../message/message-read-model';

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

async function buildFixture(
  extraSourceRows?: (chatroomId: Id<'chatroom_rooms'>) => Promise<void>
): Promise<ImportFixture> {
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
  if (extraSourceRows) await extraSourceRows(sourceChatroomId);

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

/**
 * Adds a source workspace and one agent config whose working dir does not match
 * that workspace. The export carries both; the plan must report the config as a
 * skip instead of the apply failing.
 */
async function insertMismatchedAgentConfig(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const user = await ctx.db.query('users').first();
    if (!user) throw new Error('fixture has no user');
    const workspaceId = await ctx.db.insert('chatroom_workspaces', {
      chatroomId,
      machineId: 'import-driver-source-machine',
      workingDir: '/work/source',
      hostname: 'test-host',
      registeredAt: 1,
      registeredBy: 'user',
    });
    await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
      requestKey: `${chatroomId}:trio@1:${workspaceId}:builder`,
      requestId: 'source-request',
      commandId: 'configuration:source-request',
      chatroomId,
      teamStructureId: 'trio@1',
      role: 'builder',
      agentType: 'remote',
      machineId: 'import-driver-source-machine',
      workspaceId,
      agentHarness: 'opencode-sdk',
      model: 'model-x',
      workingDir: '/work/elsewhere',
      reason: 'user.config',
      wantResume: false,
      requestedBy: user._id,
      requestedAt: 1,
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

/**
 * Inserts `count` messages, each with its read model, straight into the room.
 * Rollback must drain both tables; the rows are the only thing that matters here.
 */
async function insertBulkMessages(chatroomId: Id<'chatroom_rooms'>, count: number): Promise<void> {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      const messageId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: `bulk ${i}`,
        type: 'message',
      });
      await syncMessageReadModel(ctx, messageId);
    }
  });
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

  test('imports a file whose agent config working dir differs from its workspace', async () => {
    const fixture = await buildFixture((chatroomId) => insertMismatchedAgentConfig(chatroomId));
    const file = JSON.parse(fixture.json) as ChatroomExportFileV1;
    expect(file.agentConfigs).toHaveLength(1);
    const configKey = String(file.agentConfigs[0]?._key);

    const outcome = await runImport(importPortFor(t, fixture.sessionId), {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
    });

    expect(outcome.status).toBe('imported');
    expect(outcome.plan.report.agentConfigsSkipped).toEqual([
      { key: configKey, reason: 'working_dir_mismatch' },
    ]);

    const counts = await chatroomRowCounts(importedChatroomId(outcome));
    expect(counts.chatroom_agentLastSentLaunchRequests).toBeUndefined();
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

  test('a rollback above the old 200-call cap removes every row', async () => {
    const fixture = await buildFixture();
    const base = importPortFor(t, fixture.sessionId);
    const deletedPerCall: number[] = [];
    let started: string | undefined;
    const port: ChatroomImportPort = {
      ...base,
      applyChunk: async (a) => {
        await insertBulkMessages(a.chatroomId as Id<'chatroom_rooms'>, 1200);
        throw new Error('injected: bulk rows landed');
      },
      rollback: async (a) => {
        const result = await base.rollback(a);
        deletedPerCall.push(result.deleted);
        return result;
      },
    };

    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
      onStarted: (chatroomId) => {
        started = chatroomId;
      },
    });

    expect(rolledBackCause(outcome).message).toContain('bulk rows landed');
    // The old cap was 200 calls; this room needs more than that to drain.
    expect(deletedPerCall.length).toBeGreaterThan(200);
    expect(await chatroomRowCounts(started as Id<'chatroom_rooms'>)).toEqual({});
  });

  test('a rollback that deletes nothing stops and is reported', async () => {
    const fixture = await buildFixture();
    const base = importPortFor(t, fixture.sessionId);
    let rollbackCalls = 0;
    const port: ChatroomImportPort = {
      ...failOnNthApplyChunk(base, 2, 'after'),
      rollback: async () => {
        rollbackCalls += 1;
        return { drained: false, deleted: 0 };
      },
    };

    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
    });

    if (outcome.status !== 'rollback-failed') throw new Error(`got ${outcome.status}`);
    expect(outcome.rollbackError.message).toContain('no progress');
    expect(rollbackCalls).toBe(1);
  });

  test('a rollback that keeps deleting is not cut off by a call count', async () => {
    const fixture = await buildFixture();
    const base = importPortFor(t, fixture.sessionId);
    let rollbackCalls = 0;
    const port: ChatroomImportPort = {
      ...failOnNthApplyChunk(base, 2, 'after'),
      rollback: async () => {
        rollbackCalls += 1;
        return rollbackCalls <= 500
          ? { drained: false, deleted: 1 }
          : { drained: true, deleted: 0 };
      },
    };

    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
    });

    expect(outcome.status).toBe('rolled-back');
    expect(rollbackCalls).toBe(501);
  });

  test('a finalize that commits before the client sees an error leaves a refused rollback', async () => {
    const fixture = await buildFixture();
    const plan = await planFor(fixture);
    expect(plan.finalize.status).toBe('active'); // the fixture's source room is active; fail loudly if that changes

    const base = importPortFor(t, fixture.sessionId);
    let started: string | undefined;
    const port: ChatroomImportPort = {
      ...base,
      finalize: async (a) => {
        await base.finalize(a);
        throw new Error('injected: response lost');
      },
    };

    const outcome = await runImport(port, {
      json: fixture.json,
      machineId: fixture.machineId,
      dryRun: false,
      onStarted: (chatroomId) => {
        started = chatroomId;
      },
    });

    if (outcome.status !== 'rollback-failed') throw new Error(`got ${outcome.status}`);
    expect(outcome.orphanChatroomId).toBe(started);
    // Rollback refuses an active room (documented). The complete room stays and is reported.
    expect(await chatroomRowCounts(started as Id<'chatroom_rooms'>)).toMatchObject({
      chatroom_rooms: 1,
      chatroom_messages: 1,
      chatroom_backlog: 1,
    });
  });
});
