/**
 * Chatroom import apply core — lifecycle, chunks, refs, guards and rollback.
 *
 * Every spec calls the public `api.chatroomImport` mutations through
 * `convex-test`; nothing internal is substituted. The schema is the source of
 * truth for the rollback scan: every table that can carry a `chatroomId` is
 * checked, so a table the apply core forgets fails here.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { errorCode } from './convex-test-ports';
import type { ImportChunk, ImportHeader, ImportRowPayload } from './import-apply';
import { api } from '../../../../convex/_generated/api';
import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';
import { IMPORT_WINDOW_MS } from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let machineCounter = 0;

interface UserFixture {
  sessionId: SessionId;
  userId: Id<'users'>;
}

async function createUser(): Promise<UserFixture> {
  sessionCounter += 1;
  const sessionId = `import-apply-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  return { sessionId, userId: login.userId as Id<'users'> };
}

async function registerMachine(sessionId: SessionId, hostname = 'test-host'): Promise<string> {
  machineCounter += 1;
  const machineId = `import-apply-machine-${machineCounter}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname,
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
  return machineId;
}

function header(overrides: Partial<ImportHeader> = {}): ImportHeader {
  return { teamStructureId: 'trio@1', name: 'Imported room', ...overrides };
}

async function begin(
  sessionId: SessionId,
  machineId: string,
  overrides: Partial<ImportHeader> = {}
): Promise<Id<'chatroom_rooms'>> {
  const result = await t.mutation(api.chatroomImport.begin, {
    sessionId,
    header: header(overrides),
    machineId,
  });
  return result.chatroomId;
}

async function apply(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  chunk: ImportChunk
): Promise<{ created: Record<string, string> }> {
  return await t.mutation(api.chatroomImport.applyChunk, { sessionId, chatroomId, chunk });
}

function artifactsChunk(rows: ImportRowPayload[], refs: Record<string, string> = {}): ImportChunk {
  return { phase: 'artifacts', rows, refs };
}

function artifactRow(key: string, overrides: Record<string, unknown> = {}): ImportRowPayload {
  return {
    key,
    fields: {
      artifactGroupId: 'group-1',
      filename: `${key}.md`,
      content: `content ${key}`,
      version: 1,
      isLatest: true,
      createdBy: 'user',
      createdAt: 1,
      ...overrides,
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the mutation to fail');
}

/** Counts rows carrying `chatroomId` in every schema table. */
async function rowsByTable(chatroomId: Id<'chatroom_rooms'>): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      const rows = await ctx.db.query(table).collect();
      const count = rows.filter(
        (row) => (row as { chatroomId?: unknown }).chatroomId === chatroomId
      ).length;
      if (count > 0) counts[table] = count;
    }
    return counts;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('import lifecycle', () => {
  test('begin creates a completed, owned room with a team and read-model state', async () => {
    const { sessionId, userId } = await createUser();
    const machineId = await registerMachine(sessionId);

    const chatroomId = await begin(sessionId, machineId);

    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room?.status).toBe('completed');
    expect(room?.ownerId).toBe(userId);
    expect(room?.name).toBe('Imported room');

    const structure = await t.run((ctx) =>
      ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(structure?.teamStructureId).toBe('trio@1');

    const readModelState = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModelState')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(readModelState).not.toBeNull();

    // The seam lists every owned room, including archived ones; a room being
    // imported must never surface as active. The webapp filters `completed`
    // rooms out of the active list using this same `chatStatus`.
    const listed = await t.query(api.chatrooms.listByUserWithStatus, { sessionId });
    expect(listed.find((entry) => entry._id === chatroomId)?.chatStatus).toBe('completed');
    expect(
      listed.filter((entry) => entry.chatStatus === 'active').map((entry) => entry._id)
    ).not.toContain(chatroomId);
  });

  test('finalize activates the room, records the read cursor and clears unread', async () => {
    const { sessionId, userId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);
    const beforeFinalize = Date.now();

    await t.mutation(api.chatroomImport.finalize, {
      sessionId,
      chatroomId,
      status: 'active',
      lastActivityAt: 1_700_000_000_000,
      nextQueuePosition: 7,
    });

    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room?.status).toBe('active');
    expect(room?.lastActivityAt).toBe(1_700_000_000_000);
    expect(room?.nextQueuePosition).toBe(7);

    const cursor = await t.run((ctx) =>
      ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q) =>
          q.eq('userId', userId).eq('chatroomId', chatroomId)
        )
        .first()
    );
    expect(cursor?.lastSeenAt).toBeGreaterThanOrEqual(beforeFinalize);

    const unread = await t.run((ctx) =>
      ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q) =>
          q.eq('userId', userId).eq('chatroomId', chatroomId)
        )
        .first()
    );
    expect(unread).toBeNull();

    const listed = await t.query(api.chatrooms.listByUserWithStatus, { sessionId });
    expect(listed.find((entry) => entry._id === chatroomId)?.hasUnread).toBe(false);

    const second = await failure(
      t.mutation(api.chatroomImport.finalize, {
        sessionId,
        chatroomId,
        status: 'active',
        lastActivityAt: null,
        nextQueuePosition: 3,
      })
    );
    expect(errorCode(second)).toBe('IMPORT_TARGET_NOT_IMPORTING');
  });

  test("begin rejects an unknown team, a missing machine and another user's machine", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const machineId = await registerMachine(owner.sessionId);

    const unknownTeam = await failure(
      t.mutation(api.chatroomImport.begin, {
        sessionId: owner.sessionId,
        header: header({ teamStructureId: 'nope@9' }),
        machineId,
      })
    );
    expect(errorCode(unknownTeam)).toBe('IMPORT_UNKNOWN_TEAM_STRUCTURE');

    const missingMachine = await failure(
      t.mutation(api.chatroomImport.begin, {
        sessionId: owner.sessionId,
        header: header(),
        machineId: 'never-registered-machine',
      })
    );
    expect(errorCode(missingMachine)).toBe('IMPORT_MACHINE_NOT_FOUND');

    const foreignMachine = await failure(
      t.mutation(api.chatroomImport.begin, {
        sessionId: stranger.sessionId,
        header: header(),
        machineId,
      })
    );
    expect(errorCode(foreignMachine)).toBe('IMPORT_MACHINE_NOT_OWNED');
  });
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

describe('workspaces', () => {
  test('registers rows on the target machine and points the room at the primary', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    const result = await apply(sessionId, chatroomId, {
      phase: 'workspaces',
      machineId,
      rows: [
        { key: '0', fields: { workingDir: '/work/app', fileTreeSyncEnabled: true } },
        { key: '1', fields: { workingDir: '/work/other' } },
      ],
      primaryKey: '0',
      refs: {},
    });

    expect(Object.keys(result.created).sort()).toEqual(['0', '1']);

    const workspaces = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    workspaceCheck(workspaces, machineId, result.created);

    const primary = await t.run((ctx) =>
      ctx.db
        .query('chatroom_primaryWorkspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(primary?.workspaceId).toBe(result.created['0']);
  });
});

function workspaceCheck(
  workspaces: {
    _id: string;
    machineId: string;
    hostname: string;
    registeredBy: string;
    workingDir: string;
    fileTreeSyncEnabled?: boolean;
  }[],
  machineId: string,
  created: Record<string, string>
): void {
  expect(workspaces).toHaveLength(2);
  const byDir = new Map(workspaces.map((workspace) => [workspace.workingDir, workspace]));

  const app = byDir.get('/work/app');
  expect(app?._id).toBe(created['0']);
  expect(app?.machineId).toBe(machineId);
  expect(app?.hostname).toBe('test-host');
  expect(app?.registeredBy).toBe('user');
  expect(app?.fileTreeSyncEnabled).toBe(true);

  const other = byDir.get('/work/other');
  expect(other?._id).toBe(created['1']);
  expect(other?.machineId).toBe(machineId);
  expect(other?.hostname).toBe('test-host');
  expect(other?.registeredBy).toBe('user');
  expect(other?.fileTreeSyncEnabled).toBeFalsy();
}

// ---------------------------------------------------------------------------
// Leaf phases and refs
// ---------------------------------------------------------------------------

describe('leaf phases', () => {
  test('a later artifacts chunk resolves a ref created by an earlier chunk', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    const first = await apply(
      sessionId,
      chatroomId,
      artifactsChunk([artifactRow('a0', { isLatest: false })])
    );
    const second = await apply(
      sessionId,
      chatroomId,
      artifactsChunk([artifactRow('a1', { version: 2, previousVersionId: 'a0' })], {
        a0: first.created.a0,
      })
    );

    const row = await t.run((ctx) =>
      ctx.db.get('chatroom_artifacts', second.created.a1 as Id<'chatroom_artifacts'>)
    );
    expect(row?.previousVersionId).toBe(first.created.a0);
  });

  test('a same-chunk ref fails because only earlier chunks are in refs', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    const error = await failure(
      apply(
        sessionId,
        chatroomId,
        artifactsChunk([
          artifactRow('a0', { isLatest: false }),
          artifactRow('a1', { version: 2, previousVersionId: 'a0' }),
        ])
      )
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
  });

  test('backlog, contexts, savedCommands, skillCustomizations and scheduledPrompts insert rows', async () => {
    const { sessionId, userId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    await apply(sessionId, chatroomId, {
      phase: 'backlog',
      rows: [
        {
          key: 'b0',
          fields: {
            createdBy: 'user',
            content: 'backlog item',
            status: 'backlog',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'contexts',
      rows: [{ key: 'c0', fields: { content: 'context', createdBy: 'user', createdAt: 1 } }],
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'savedCommands',
      rows: [
        {
          key: 's0',
          fields: {
            type: 'prompt',
            scope: 'chatroom',
            name: 'saved',
            prompt: 'do it',
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'skillCustomizations',
      rows: [
        {
          key: 'k0',
          fields: {
            type: 'development_workflow',
            name: 'custom',
            content: 'override',
            isEnabled: true,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'scheduledPrompts',
      rows: [
        {
          key: 'p0',
          fields: {
            prompt: 'scheduled',
            scheduleKind: 'interval',
            intervalMinutes: 5,
            isRunnable: false,
            disabledReason: 'user',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      refs: {},
    });

    const backlog = await t.run((ctx) =>
      ctx.db
        .query('chatroom_backlog')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(backlog?.content).toBe('backlog item');
    expect(backlog?.chatroomId).toBe(chatroomId);

    const context = await t.run((ctx) =>
      ctx.db
        .query('chatroom_contexts')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(context?.content).toBe('context');

    const savedCommand = await t.run((ctx) =>
      ctx.db
        .query('chatroom_savedCommands')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(savedCommand?.name).toBe('saved');

    const customization = await t.run((ctx) =>
      ctx.db
        .query('chatroom_skillCustomizations')
        .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(customization?.ownerId).toBe(userId);
    expect(customization?.chatroomId).toBe(chatroomId);

    const prompt = await t.run((ctx) =>
      ctx.db
        .query('chatroom_scheduledPrompts')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(prompt?.createdBy).toBe(userId);
    expect(prompt?.chatroomId).toBe(chatroomId);
  });

  test('the field whitelist refuses server, unknown and system fields', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    for (const fields of [{ ownerId: 'x' }, { chatroomId }, { notAField: 1 }]) {
      const error = await failure(
        apply(sessionId, chatroomId, artifactsChunk([{ key: 'bad', fields }]))
      );
      expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
    }
  });

  test('a ref pointing at another chatroom is refused', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);
    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });
    const foreignArtifactId = await t.run((ctx) =>
      ctx.db.insert('chatroom_artifacts', {
        chatroomId: otherChatroomId,
        artifactGroupId: 'other-group',
        filename: 'other.md',
        content: 'other',
        version: 1,
        isLatest: true,
        createdBy: 'user',
        createdAt: 1,
      })
    );

    const error = await failure(
      apply(
        sessionId,
        chatroomId,
        artifactsChunk([artifactRow('a1', { previousVersionId: 'foreign' })], {
          foreign: foreignArtifactId,
        })
      )
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
  });

  test('a phase outside this phase range is refused', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'nonexistent',
        rows: [],
        refs: {},
      } as unknown as ImportChunk)
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('guards', () => {
  test('active rooms are refused and rollback does not delete them', async () => {
    const { sessionId } = await createUser();
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });

    const applyError = await failure(
      apply(sessionId, chatroomId, {
        phase: 'backlog',
        rows: [
          {
            key: 'b0',
            fields: {
              createdBy: 'user',
              content: 'x',
              status: 'backlog',
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        refs: {},
      })
    );
    expect(errorCode(applyError)).toBe('IMPORT_TARGET_NOT_IMPORTING');

    const finalizeError = await failure(
      t.mutation(api.chatroomImport.finalize, {
        sessionId,
        chatroomId,
        status: 'active',
        lastActivityAt: null,
        nextQueuePosition: 0,
      })
    );
    expect(errorCode(finalizeError)).toBe('IMPORT_TARGET_NOT_IMPORTING');

    const rollbackError = await failure(
      t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId })
    );
    expect(errorCode(rollbackError)).toBe('IMPORT_TARGET_NOT_IMPORTING');

    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room).not.toBeNull();
  });

  test("another user cannot apply or roll back someone else's import", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const machineId = await registerMachine(owner.sessionId);
    const chatroomId = await begin(owner.sessionId, machineId);

    const applyError = await failure(
      apply(stranger.sessionId, chatroomId, artifactsChunk([artifactRow('a0')]))
    );
    expect(errorCode(applyError)).toBe('IMPORT_TARGET_NOT_IMPORTING');

    const rollbackError = await failure(
      t.mutation(api.chatroomImport.rollback, {
        sessionId: stranger.sessionId,
        chatroomId,
      })
    );
    expect(errorCode(rollbackError)).toBe('IMPORT_TARGET_NOT_IMPORTING');
  });

  test('a room older than the import window refuses writes', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);
    const now = Date.now();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now + IMPORT_WINDOW_MS + 1);

    const error = await failure(apply(sessionId, chatroomId, artifactsChunk([artifactRow('a0')])));
    expect(errorCode(error)).toBe('IMPORT_TARGET_NOT_IMPORTING');
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

describe('rollback', () => {
  test('drains a partial import to zero rows and leaves another room alone', async () => {
    const { sessionId, userId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    await apply(sessionId, chatroomId, {
      phase: 'workspaces',
      machineId,
      rows: [{ key: '0', fields: { workingDir: '/work/app' } }],
      primaryKey: '0',
      refs: {},
    });
    await apply(sessionId, chatroomId, artifactsChunk([artifactRow('a0')]));
    await apply(sessionId, chatroomId, {
      phase: 'backlog',
      rows: [
        {
          key: 'b0',
          fields: {
            createdBy: 'user',
            content: 'b',
            status: 'backlog',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ],
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'savedCommands',
      rows: [
        {
          key: 's0',
          fields: {
            type: 'prompt',
            scope: 'chatroom',
            name: 'saved',
            prompt: 'p',
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      refs: {},
    });

    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });
    const otherBefore = await rowsByTable(otherChatroomId);

    const result = await t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId });
    expect(result).toEqual({ drained: true });

    expect(await rowsByTable(chatroomId)).toEqual({});
    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room).toBeNull();

    const cursor = await t.run((ctx) =>
      ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q) =>
          q.eq('userId', userId).eq('chatroomId', chatroomId)
        )
        .first()
    );
    expect(cursor).toBeNull();

    expect(await rowsByTable(otherChatroomId)).toEqual(otherBefore);
  });

  test('drains across calls within the rollback budget', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    await apply(sessionId, chatroomId, {
      phase: 'backlog',
      rows: backlogRows(0, 200),
      refs: {},
    });
    await apply(sessionId, chatroomId, {
      phase: 'backlog',
      rows: backlogRows(200, 150),
      refs: {},
    });

    const first = await t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId });
    expect(first).toEqual({ drained: false });

    const second = await t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId });
    expect(second).toEqual({ drained: true });

    expect(await rowsByTable(chatroomId)).toEqual({});
  });

  test('rolling back an already deleted room is idempotent', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    const first = await t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId });
    expect(first).toEqual({ drained: true });

    const second = await t.mutation(api.chatroomImport.rollback, { sessionId, chatroomId });
    expect(second).toEqual({ drained: true });
  });
});

function backlogRows(start: number, count: number): ImportRowPayload[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `b${start + index}`,
    fields: {
      createdBy: 'user',
      content: `backlog ${start + index}`,
      status: 'backlog',
      createdAt: 1,
      updatedAt: 1,
    },
  }));
}

// ---------------------------------------------------------------------------
// Round-final end-to-end evidence
// ---------------------------------------------------------------------------

describe('end-to-end', () => {
  test('imports through finalize, lists it read, then rolls back a second partial import', async () => {
    const { sessionId } = await createUser();
    const machineId = await registerMachine(sessionId);
    const chatroomId = await begin(sessionId, machineId);

    await apply(sessionId, chatroomId, {
      phase: 'workspaces',
      machineId,
      rows: [{ key: 'w0', fields: { workingDir: '/work/app', fileTreeSyncEnabled: true } }],
      primaryKey: 'w0',
      refs: {},
    });
    const firstArtifact = await apply(
      sessionId,
      chatroomId,
      artifactsChunk([artifactRow('a0', { isLatest: false })])
    );
    const secondArtifact = await apply(
      sessionId,
      chatroomId,
      artifactsChunk([artifactRow('a1', { version: 2, previousVersionId: 'a0' })], {
        a0: firstArtifact.created.a0,
      })
    );

    await t.mutation(api.chatroomImport.finalize, {
      sessionId,
      chatroomId,
      status: 'active',
      lastActivityAt: 1_700_000_000_000,
      nextQueuePosition: 7,
    });

    const listed = await t.query(api.chatrooms.listByUserWithStatus, { sessionId });
    const imported = listed.find((entry) => entry._id === chatroomId);
    expect(imported?.status).toBe('active');
    expect(imported?.hasUnread).toBe(false);

    const artifact = await t.run((ctx) =>
      ctx.db.get('chatroom_artifacts', secondArtifact.created.a1 as Id<'chatroom_artifacts'>)
    );
    expect(artifact?.previousVersionId).toBe(firstArtifact.created.a0);

    // A second, partial import must roll back to zero rows.
    const partialId = await begin(sessionId, machineId, { name: 'Partial' });
    await apply(sessionId, partialId, artifactsChunk([artifactRow('a0')]));
    expect(await rowsByTable(partialId)).not.toEqual({});

    const rollback = await t.mutation(api.chatroomImport.rollback, {
      sessionId,
      chatroomId: partialId,
    });
    expect(rollback).toEqual({ drained: true });
    expect(await rowsByTable(partialId)).toEqual({});
  });
});
