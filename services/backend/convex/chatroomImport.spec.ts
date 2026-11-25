/**
 * Chatroom import preflight — auth, target facts and the no-write guarantee.
 *
 * `preflight` is the only Convex surface P6 adds. Its seams are the public query
 * (`t.query(api.chatroomImport.preflight, …)`) and a row-count snapshot of every
 * schema table, which proves the query writes nothing.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode } from '../src/domain/usecase/chatroom-transfer/convex-test-ports';
import { t } from '../test.setup';
import { api } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import schema from './schema';

let sessionCounter = 0;

async function createSession(): Promise<SessionId> {
  sessionCounter += 1;
  const sessionId = `chatroom-import-preflight-${sessionCounter}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  return sessionId;
}

async function registerMachine(sessionId: SessionId, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the query to fail');
}

async function rowCounts(): Promise<Record<string, number>> {
  const tables = Object.keys(schema.tables) as TableNames[];
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return counts;
  });
}

describe('chatroomImport.preflight auth', () => {
  test('rejects an invalid session', async () => {
    const error = await failure(
      t.query(api.chatroomImport.preflight, {
        sessionId: 'chatroom-import-never-logged-in' as SessionId,
        machineId: 'never-registered-machine',
        teamStructureId: 'trio@1',
        workingDirs: [],
      })
    );

    expect(errorCode(error)).toBe('NOT_AUTHENTICATED');
  });

  test('rejects an unregistered machine with IMPORT_MACHINE_NOT_FOUND', async () => {
    const sessionId = await createSession();

    const error = await failure(
      t.query(api.chatroomImport.preflight, {
        sessionId,
        machineId: 'missing-machine',
        teamStructureId: 'trio@1',
        workingDirs: [],
      })
    );

    expect(errorCode(error)).toBe('IMPORT_MACHINE_NOT_FOUND');
  });

  test("rejects another user's machine with IMPORT_MACHINE_NOT_OWNED", async () => {
    const owner = await createSession();
    const stranger = await createSession();
    const machineId = 'owned-by-owner-machine';
    await registerMachine(owner, machineId);

    const error = await failure(
      t.query(api.chatroomImport.preflight, {
        sessionId: stranger,
        machineId,
        teamStructureId: 'trio@1',
        workingDirs: [],
      })
    );

    expect(errorCode(error)).toBe('IMPORT_MACHINE_NOT_OWNED');
  });
});

describe('chatroomImport.preflight target facts', () => {
  test('returns hostname, harnesses, team knowledge and invalid working directories', async () => {
    const sessionId = await createSession();
    const machineId = 'preflight-facts-machine';
    await registerMachine(sessionId, machineId);

    const result = await t.query(api.chatroomImport.preflight, {
      sessionId,
      machineId,
      teamStructureId: 'trio@1',
      workingDirs: ['/ok/path', '/a\\b'],
    });

    expect(result).toEqual({
      hostname: 'test-host',
      availableHarnesses: ['opencode-sdk'],
      teamStructureKnown: true,
      invalidWorkingDirs: ['/a\\b'],
    });

    const unknownTeam = await t.query(api.chatroomImport.preflight, {
      sessionId,
      machineId,
      teamStructureId: 'nope@9',
      workingDirs: [],
    });

    expect(unknownTeam.teamStructureKnown).toBe(false);
  });

  test('writes nothing to any schema table', async () => {
    const sessionId = await createSession();
    const machineId = 'preflight-read-only-machine';
    await registerMachine(sessionId, machineId);

    const before = await rowCounts();
    await t.query(api.chatroomImport.preflight, {
      sessionId,
      machineId,
      teamStructureId: 'trio@1',
      workingDirs: ['/ok/path'],
    });
    const after = await rowCounts();

    expect(after).toEqual(before);
  });
});
